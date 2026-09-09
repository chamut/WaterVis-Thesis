"""Build browser-sized Goulburn 2024 files without modifying the downloads."""

from __future__ import annotations

import csv
import json
import math
import re
import statistics
import struct
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PROJECT_ROOT.parent
SOURCE_DIR = WORKSPACE_ROOT / "Data" / "goulburn 2024 additional"
ERS_DIR = WORKSPACE_ROOT / "Data" / "ERS data vic"
BOUNDARY_ARCHIVE = WORKSPACE_ROOT / "Data" / "Basin boundaries.zip"
OUTPUT_DIR = PROJECT_ROOT / "public" / "data"
TARGET_YEAR = "2024"

PARAMETERS = {
    "DO": {"label": "Dissolved oxygen saturation", "short_label": "DO", "unit": "% saturation (estimated)", "ers_statistic": "25th percentile and maximum"},
    "TN": {"label": "Total nitrogen", "short_label": "TN", "unit": "mg/L", "ers_statistic": "75th percentile"},
    "TP": {"label": "Total phosphorus", "short_label": "TP", "unit": "mg/L", "ers_statistic": "75th percentile"},
    "TURB": {"label": "Turbidity", "short_label": "Turbidity", "unit": "NTU", "ers_statistic": "75th percentile"},
    "PH": {"label": "pH", "short_label": "pH", "unit": "pH units", "ers_statistic": "25th and 75th percentiles"},
}

# Table 5.8, Environment Reference Standard. Nutrient objectives are converted
# from micrograms/L in the source table to mg/L to match the WMIS extract.
ERS_THRESHOLDS = {
    "Uplands A": {
        "context": "Upper Goulburn (part) and Broken basins",
        "TP": {"upper": 0.025, "upper_stat": "p75"},
        "TN": {"upper": 0.550, "upper_stat": "p75"},
        "DO": {"lower": 90.0, "upper": 130.0, "lower_stat": "p25", "upper_stat": "max"},
        "TURB": {"upper": 10.0, "upper_stat": "p75"},
        "PH": {"lower": 6.4, "upper": 7.4, "lower_stat": "p25", "upper_stat": "p75"},
    },
    "Uplands B": {
        "context": "Northern-draining uplands: Ovens, Broken and Goulburn (part)",
        "TP": {"upper": 0.025, "upper_stat": "p75"},
        "TN": {"upper": 0.400, "upper_stat": "p75"},
        "DO": {"lower": 85.0, "upper": 130.0, "lower_stat": "p25", "upper_stat": "max"},
        "TURB": {"upper": 10.0, "upper_stat": "p75"},
        "PH": {"lower": 6.4, "upper": 7.4, "lower_stat": "p25", "upper_stat": "p75"},
    },
    "Central Foothills and Coastal Plains": {
        "context": "Foothills of Ovens, Broken and Goulburn basins",
        "TP": {"upper": 0.050, "upper_stat": "p75"},
        "TN": {"upper": 0.800, "upper_stat": "p75"},
        "DO": {"lower": 70.0, "upper": 130.0, "lower_stat": "p25", "upper_stat": "max"},
        "TURB": {"upper": 20.0, "upper_stat": "p75"},
        "PH": {"lower": 6.4, "upper": 7.4, "lower_stat": "p25", "upper_stat": "p75"},
    },
    "Murray and Western Plains": {
        "context": "Lowlands of Kiewa, Ovens and Goulburn basins",
        "TP": {"upper": 0.055, "upper_stat": "p75"},
        "TN": {"upper": 0.800, "upper_stat": "p75"},
        "DO": {"lower": 75.0, "upper": 130.0, "lower_stat": "p25", "upper_stat": "max"},
        "TURB": {"upper": 25.0, "upper_stat": "p75"},
        "PH": {"lower": 6.4, "upper": 7.5, "lower_stat": "p25", "upper_stat": "p75"},
    },
}

# Provisional display policy only. Excluded records remain counted in daily
# output so the quality decision is visible and reversible.
DISPLAY_QUALITY_CODES = {"1", "2", "8", "11", "15", "50", "76"}
EXCLUDED_QUALITY_CODES = {"3", "100", "151", "153", "161", "180", "255"}


def canonical_parameter(name: str) -> str | None:
    lower = name.strip().lower()
    if "dissolved oxygen" in lower:
        return "DO"
    if lower == "nitrogen as total":
        return "TN"
    if lower == "phosphorus (total)":
        return "TP"
    if lower == "turbidity":
        return "TURB"
    if lower == "ph":
        return "PH"
    return None


def parse_dms(value: str) -> float:
    match = re.fullmatch(r"\s*(\d+)\D+(\d+)'([\d.]+)\"([NSEW])\s*", value)
    if not match:
        raise ValueError(f"Unrecognised DMS coordinate: {value!r}")
    degrees, minutes, seconds, hemisphere = match.groups()
    decimal = float(degrees) + float(minutes) / 60 + float(seconds) / 3600
    return -decimal if hemisphere in "SW" else decimal


def iso_datetime(value: str) -> str:
    return datetime.strptime(value, "%Y/%m/%d %H:%M:%S").isoformat()


def read_csv(path: Path, encoding: str = "cp1252"):
    with path.open("r", encoding=encoding, newline="") as handle:
        yield from csv.DictReader(handle)


def quantile(values: list[float], probability: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def dissolved_oxygen_saturation(do_mg_l: float, temperature_c: float, elevation_m: float) -> float:
    """Estimate freshwater DO saturation using Weiss solubility and elevation pressure."""
    kelvin = temperature_c + 273.15
    solubility_sea_level = 1.42905 * math.exp(
        -173.4292
        + 249.6339 * (100 / kelvin)
        + 143.3483 * math.log(kelvin / 100)
        - 21.8492 * (kelvin / 100)
    )
    pressure_ratio = max(0.5, (1 - 2.25577e-5 * max(elevation_m, 0)) ** 5.25588)
    return do_mg_l / (solubility_sea_level * pressure_ratio) * 100


def read_dbf_records(data: bytes) -> list[dict[str, str]]:
    record_count = struct.unpack("<I", data[4:8])[0]
    header_length = struct.unpack("<H", data[8:10])[0]
    record_length = struct.unpack("<H", data[10:12])[0]
    fields = []
    position = 32
    while data[position] != 0x0D:
        descriptor = data[position : position + 32]
        name = descriptor[:11].split(b"\0", 1)[0].decode("ascii", "replace")
        fields.append((name, descriptor[16]))
        position += 32
    rows = []
    for index in range(record_count):
        record = data[header_length + index * record_length : header_length + (index + 1) * record_length]
        if not record or record[:1] == b"*":
            continue
        offset = 1
        row = {}
        for name, length in fields:
            row[name] = record[offset : offset + length].decode("cp1252", "replace").strip()
            offset += length
        rows.append(row)
    return rows


def read_polygon_shapes(shp_path: Path, records: list[dict[str, str]]) -> list[dict]:
    shape_data = shp_path.read_bytes()
    position = 100
    record_index = 0
    features = []
    while position < len(shape_data) and record_index < len(records):
        _, content_length_words = struct.unpack(">2i", shape_data[position : position + 8])
        content_length = content_length_words * 2
        content = shape_data[position + 8 : position + 8 + content_length]
        shape_type = struct.unpack("<i", content[:4])[0]
        if shape_type in (5, 15, 25):
            part_count, point_count = struct.unpack("<2i", content[36:44])
            parts = list(struct.unpack(f"<{part_count}i", content[44 : 44 + part_count * 4]))
            points_offset = 44 + part_count * 4
            points = [
                struct.unpack("<2d", content[points_offset + index * 16 : points_offset + (index + 1) * 16])
                for index in range(point_count)
            ]
            parts.append(point_count)
            features.append({"properties": records[record_index], "rings": [points[parts[index] : parts[index + 1]] for index in range(part_count)]})
        position += 8 + content_length
        record_index += 1
    return features


def point_in_ring(longitude: float, latitude: float, ring) -> bool:
    inside = False
    previous = len(ring) - 1
    for current, (x_current, y_current) in enumerate(ring):
        x_previous, y_previous = ring[previous]
        crosses = (y_current > latitude) != (y_previous > latitude)
        if crosses and longitude < (x_previous - x_current) * (latitude - y_current) / (y_previous - y_current) + x_current:
            inside = not inside
        previous = current
    return inside


def point_in_feature(longitude: float, latitude: float, feature: dict) -> bool:
    inside = False
    for ring in feature["rings"]:
        if point_in_ring(longitude, latitude, ring):
            inside = not inside
    return inside


def load_ers_features() -> list[dict]:
    records = read_dbf_records((ERS_DIR / "WATER_ERS_POLYGON.dbf").read_bytes())
    latest_approval = max(row["DateApprov"] for row in records)
    return [
        feature
        for feature in read_polygon_shapes(ERS_DIR / "WATER_ERS_POLYGON.shp", records)
        if feature["properties"]["WaterType"] == "Inland" and feature["properties"]["DateApprov"] == latest_approval
    ]


def assign_ers_segment(longitude: float, latitude: float, features: list[dict]) -> str:
    matches = {feature["properties"]["SegmtType"] for feature in features if point_in_feature(longitude, latitude, feature)}
    if len(matches) != 1:
        raise ValueError(f"Expected one ERS segment at {latitude}, {longitude}; found {sorted(matches)}")
    return matches.pop()


def classify_point(segment: str, parameter_code: str, value: float | None) -> str:
    if value is None or segment not in ERS_THRESHOLDS:
        return "unavailable"
    objective = ERS_THRESHOLDS[segment][parameter_code]
    if "lower" in objective and value < objective["lower"]:
        return "outside"
    if "upper" in objective and value > objective["upper"]:
        return "outside"
    return "within"


def assess_series(segment: str, parameter_code: str, values: list[float]) -> dict:
    objective = ERS_THRESHOLDS.get(segment, {}).get(parameter_code)
    stats = {"p25": quantile(values, 0.25), "median": quantile(values, 0.5), "p75": quantile(values, 0.75), "max": max(values) if values else None}
    if not objective or not values:
        return {"status": "unavailable", "objective": objective, "statistics": stats}
    passes = True
    if "lower" in objective:
        passes &= stats[objective["lower_stat"]] >= objective["lower"]
    if "upper" in objective:
        passes &= stats[objective["upper_stat"]] <= objective["upper"]
    return {
        "status": "within" if passes else "outside",
        "objective": objective,
        "statistics": {key: None if value is None else round(value, 5) for key, value in stats.items()},
    }


def new_daily_bucket() -> dict:
    return {"n_total": 0, "n_usable": 0, "sum": 0.0, "min": math.inf, "max": -math.inf, "raw_sum": 0.0, "temperature_sum": 0.0, "temperature_count": 0, "qualities": Counter()}


def signed_area(ring: list[list[float]]) -> float:
    return sum(ring[index][0] * ring[(index + 1) % len(ring)][1] - ring[(index + 1) % len(ring)][0] * ring[index][1] for index in range(len(ring))) / 2


def perpendicular_distance(point, start, end) -> float:
    if start == end:
        return math.dist(point, start)
    numerator = abs((end[1] - start[1]) * point[0] - (end[0] - start[0]) * point[1] + end[0] * start[1] - end[1] * start[0])
    return numerator / math.hypot(end[1] - start[1], end[0] - start[0])


def simplify_line(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 2:
        return points
    distances = [perpendicular_distance(point, points[0], points[-1]) for point in points[1:-1]]
    max_distance = max(distances, default=0)
    if max_distance <= tolerance:
        return [points[0], points[-1]]
    max_index = distances.index(max_distance) + 1
    return simplify_line(points[: max_index + 1], tolerance)[:-1] + simplify_line(points[max_index:], tolerance)


def simplify_ring(ring: list[list[float]], tolerance: float = 0.002) -> list[list[float]]:
    open_ring = ring[:-1] if ring and ring[0] == ring[-1] else ring
    if len(open_ring) < 4:
        return ring
    simplified = simplify_line(open_ring + [open_ring[0]], tolerance)
    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified if len(simplified) >= 4 else ring


def extract_goulburn_boundary() -> dict:
    with zipfile.ZipFile(BOUNDARY_ARCHIVE) as archive:
        dbf_name = next(name for name in archive.namelist() if name.lower().endswith(".dbf"))
        shp_name = next(name for name in archive.namelist() if name.lower().endswith(".shp"))
        records = read_dbf_records(archive.read(dbf_name))
        target_index = next(index for index, row in enumerate(records) if row.get("BASIN_NAME") == "Goulburn River")
        shape_data = archive.read(shp_name)
    position = 100
    record_index = 0
    rings = None
    while position < len(shape_data):
        _, content_length_words = struct.unpack(">2i", shape_data[position : position + 8])
        content_length = content_length_words * 2
        content = shape_data[position + 8 : position + 8 + content_length]
        if record_index == target_index:
            part_count, point_count = struct.unpack("<2i", content[36:44])
            parts = list(struct.unpack(f"<{part_count}i", content[44 : 44 + part_count * 4]))
            points_offset = 44 + part_count * 4
            points = [list(struct.unpack("<2d", content[points_offset + index * 16 : points_offset + (index + 1) * 16])) for index in range(point_count)]
            parts.append(point_count)
            rings = [simplify_ring(points[parts[index] : parts[index + 1]]) for index in range(part_count)]
            break
        position += 8 + content_length
        record_index += 1
    if not rings:
        raise RuntimeError("Goulburn River polygon was not found")
    polygons = []
    for ring in rings:
        if signed_area(ring) < 0 or not polygons:
            polygons.append([ring])
        else:
            polygons[-1].append(ring)
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"basin_no": 5, "name": "Goulburn River"}, "geometry": {"type": "MultiPolygon", "coordinates": polygons}}]}


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    required = [SOURCE_DIR / "data.0.csv", SOURCE_DIR / "SW Metadata.csv", SOURCE_DIR / "Quality codes.csv", ERS_DIR / "WATER_ERS_POLYGON.dbf", ERS_DIR / "WATER_ERS_POLYGON.shp", BOUNDARY_ARCHIVE]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing source files: {missing}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    metadata_rows = list(read_csv(SOURCE_DIR / "SW Metadata.csv"))
    metadata_by_site = {row["Site ID"].strip(): row for row in metadata_rows}
    quality_definitions = {row["Quality"].strip(): row["Text"].strip() for row in read_csv(SOURCE_DIR / "Quality codes.csv")}
    ers_features = load_ers_features()
    site_context = {}
    for row in metadata_rows:
        site_id = row["Site ID"].strip()
        latitude = parse_dms(row["Latitude"])
        longitude = parse_dms(row["Longitude"])
        site_context[site_id] = {"latitude": latitude, "longitude": longitude, "elevation": float(row["Elevation (m)"] or 0), "segment": assign_ers_segment(longitude, latitude, ers_features)}

    source_path = SOURCE_DIR / "data.0.csv"
    do_sites = set()
    with source_path.open("r", encoding="cp1252", newline="") as handle:
        for row in csv.DictReader(handle):
            if "dissolved oxygen" in row["Parameter"].strip().lower():
                do_sites.add(row["Site ID"].strip())

    temperatures = {}
    with source_path.open("r", encoding="cp1252", newline="") as handle:
        for row in csv.DictReader(handle):
            site_id = row["Site ID"].strip()
            if site_id in do_sites and row["Parameter"].strip() == "Water Temperature":
                temperatures[(site_id, row["Data Type"].strip(), row["Datetime"].strip())] = float(row["Value"])

    total_rows = 0
    boundary_rows = 0
    target_site_ids = set()
    spot_rows = []
    daily = {}
    hourly = {}
    cell_raw = {}
    observed_quality_codes = Counter()
    do_saturation_rows = 0
    do_unpaired_rows = 0

    with source_path.open("r", encoding="cp1252", newline="") as handle:
        for row in csv.DictReader(handle):
            total_rows += 1
            parameter_code = canonical_parameter(row["Parameter"])
            if parameter_code is None:
                continue
            site_id = row["Site ID"].strip()
            date_time = row["Datetime"].strip()
            data_type = row["Data Type"].strip()
            raw_value = float(row["Value"])
            quality_code = row["Quality"].strip()
            raw_unit = row["Unit of Measurement"].strip()
            context = site_context[site_id]
            display_value = raw_value
            temperature = None
            if parameter_code == "DO":
                temperature = temperatures.get((site_id, data_type, date_time))
                if temperature is None:
                    display_value = None
                    do_unpaired_rows += 1
                else:
                    display_value = dissolved_oxygen_saturation(raw_value, temperature, context["elevation"])
                    do_saturation_rows += 1

            target_site_ids.add(site_id)
            observed_quality_codes[quality_code] += 1
            cell_key = (site_id, parameter_code)
            cell = cell_raw.setdefault(cell_key, {"spot_count": 0, "continuous_count": 0, "date_min": date_time, "date_max": date_time, "spot_values": []})
            cell["date_min"] = min(cell["date_min"], date_time)
            cell["date_max"] = max(cell["date_max"], date_time)
            if not date_time.startswith(TARGET_YEAR + "/"):
                boundary_rows += 1
                continue

            point_status = classify_point(context["segment"], parameter_code, display_value)
            if data_type == "Quality":
                cell["spot_count"] += 1
                if display_value is not None:
                    cell["spot_values"].append(display_value)
                spot_rows.append({
                    "site_id": site_id, "site_name": row["Name"].strip(), "datetime": iso_datetime(date_time),
                    "parameter_code": parameter_code, "parameter_name": PARAMETERS[parameter_code]["label"],
                    "value": "" if display_value is None else f"{display_value:.6g}", "unit": PARAMETERS[parameter_code]["unit"],
                    "raw_value": f"{raw_value:g}", "raw_unit": raw_unit,
                    "temperature_c": "" if temperature is None else f"{temperature:g}", "ers_point_status": point_status,
                    "qualifier": row["Qualifier"].strip(), "quality_code": quality_code,
                    "quality_text": quality_definitions.get(quality_code, "Unknown code"),
                })
                continue
            if data_type != "Quantity":
                continue
            cell["continuous_count"] += 1
            day = date_time[:10].replace("/", "-")
            hour = f"{day}T{date_time[11:13]}:00:00"
            for bucket in (
                daily.setdefault((site_id, parameter_code, day), new_daily_bucket()),
                hourly.setdefault((site_id, parameter_code, hour), new_daily_bucket()),
            ):
                bucket["n_total"] += 1
                bucket["qualities"][quality_code] += 1
                if quality_code in DISPLAY_QUALITY_CODES and display_value is not None:
                    bucket["n_usable"] += 1
                    bucket["sum"] += display_value
                    bucket["min"] = min(bucket["min"], display_value)
                    bucket["max"] = max(bucket["max"], display_value)
                    bucket["raw_sum"] += raw_value
                    if temperature is not None:
                        bucket["temperature_sum"] += temperature
                        bucket["temperature_count"] += 1

    daily_rows = []
    daily_values_by_cell = {}
    for (site_id, parameter_code, day), bucket in sorted(daily.items()):
        count = bucket["n_usable"]
        mean = bucket["sum"] / count if count else None
        if mean is not None:
            daily_values_by_cell.setdefault((site_id, parameter_code), []).append(mean)
        segment = site_context[site_id]["segment"]
        daily_rows.append({
            "site_id": site_id, "date": day, "parameter_code": parameter_code, "parameter_name": PARAMETERS[parameter_code]["label"],
            "unit": PARAMETERS[parameter_code]["unit"], "value_mean": "" if mean is None else f"{mean:.6g}",
            "value_min": "" if count == 0 else f"{bucket['min']:.6g}", "value_max": "" if count == 0 else f"{bucket['max']:.6g}",
            "raw_value_mean": "" if count == 0 else f"{bucket['raw_sum'] / count:.6g}",
            "raw_unit": "ppm" if parameter_code == "DO" else PARAMETERS[parameter_code]["unit"],
            "temperature_c": "" if not bucket["temperature_count"] else f"{bucket['temperature_sum'] / bucket['temperature_count']:.6g}",
            "ers_point_status": classify_point(segment, parameter_code, mean), "n_total": bucket["n_total"], "n_usable": count,
            "n_flagged": bucket["n_total"] - count,
            "quality_codes": ";".join(f"{code}:{number}" for code, number in sorted(bucket["qualities"].items(), key=lambda item: int(item[0]))),
        })

    hourly_rows = []
    for (site_id, parameter_code, hour), bucket in sorted(hourly.items()):
        count = bucket["n_usable"]
        mean = bucket["sum"] / count if count else None
        segment = site_context[site_id]["segment"]
        hourly_rows.append({
            "site_id": site_id, "datetime": hour, "parameter_code": parameter_code,
            "parameter_name": PARAMETERS[parameter_code]["label"], "unit": PARAMETERS[parameter_code]["unit"],
            "value_mean": "" if mean is None else f"{mean:.6g}",
            "value_min": "" if count == 0 else f"{bucket['min']:.6g}", "value_max": "" if count == 0 else f"{bucket['max']:.6g}",
            "raw_value_mean": "" if count == 0 else f"{bucket['raw_sum'] / count:.6g}",
            "raw_unit": "ppm" if parameter_code == "DO" else PARAMETERS[parameter_code]["unit"],
            "temperature_c": "" if not bucket["temperature_count"] else f"{bucket['temperature_sum'] / bucket['temperature_count']:.6g}",
            "ers_point_status": classify_point(segment, parameter_code, mean), "n_total": bucket["n_total"], "n_usable": count,
            "n_flagged": bucket["n_total"] - count,
            "quality_codes": ";".join(f"{code}:{number}" for code, number in sorted(bucket["qualities"].items(), key=lambda item: int(item[0]))),
        })

    sites_rows = []
    for source in metadata_rows:
        site_id = source["Site ID"].strip()
        context = site_context[site_id]
        sites_rows.append({
            "site_id": site_id, "name": source["Name"].strip(), "short_name": source["Short Name"].strip() or source["Name"].strip(),
            "latitude": f"{context['latitude']:.7f}", "longitude": f"{context['longitude']:.7f}",
            "source_crs": source["Geographic Coordinate System"].strip(), "easting": source["Easting"].strip(),
            "northing": source["Northing"].strip(), "zone": source["Zone"].strip(), "elevation_m": f"{context['elevation']:g}",
            "ers_segment": context["segment"], "active": source["Active"].strip().lower(), "cease_date": source["Cease date"].strip(),
            "basin": source["Basin"].strip(), "site_types": source["Site types"].strip(), "has_target_data_2024": str(site_id in target_site_ids).lower(),
        })

    availability_sites = {}
    for site_id in sorted(target_site_ids):
        site_parameters = {}
        for parameter_code in PARAMETERS:
            raw = cell_raw.get((site_id, parameter_code))
            if not raw:
                continue
            daily_values = daily_values_by_cell.get((site_id, parameter_code), [])
            spot_values = raw["spot_values"]
            summary_values = daily_values or spot_values
            regimes = []
            if raw["continuous_count"]:
                regimes.append("continuous")
            if raw["spot_count"]:
                regimes.append("spot")
            assessment = assess_series(site_context[site_id]["segment"], parameter_code, summary_values)
            site_parameters[parameter_code] = {
                "regime": "+".join(regimes), "unit": PARAMETERS[parameter_code]["unit"], "spot_count": raw["spot_count"],
                "continuous_count": raw["continuous_count"], "daily_count": len(daily_values), "date_min": raw["date_min"],
                "date_max": raw["date_max"], "summary_value": round(statistics.median(summary_values), 5) if summary_values else None,
                "summary_source": "daily sensor summaries" if daily_values else "spot observations", "ers_assessment": assessment,
            }
        metadata = metadata_by_site[site_id]
        availability_sites[site_id] = {
            "name": metadata["Short Name"].strip() or metadata["Name"].strip(), "active": metadata["Active"].strip().lower() == "true",
            "ers_segment": site_context[site_id]["segment"], "parameters": site_parameters,
        }

    availability = {
        "title": "Goulburn 2024 availability and provisional ERS assessment", "generated_at": datetime.now(timezone.utc).isoformat(),
        "year": 2024, "source_rows": total_rows, "excluded_boundary_rows": boundary_rows,
        "parameters": [dict(code=code, **definition) for code, definition in PARAMETERS.items()],
        "temporal_resolutions": {
            "daily": {"available": True, "source": "continuous_daily.csv"},
            "monthly": {"available": True, "source": "client aggregation of daily summaries"},
            "hourly": {"available": True, "source": "continuous_hourly.csv", "loading": "on demand"},
        },
        "ers": {
            "source": "EPA Victoria Environment Reference Standard, Table 5.8",
            "source_url": "https://www.epa.vic.gov.au/sites/default/files/2025-05/consolidated-ERS.pdf",
            "assessment_note": "Provisional annual comparison using daily sensor summaries where available, otherwise spot observations.",
            "do_note": "DO percent saturation is estimated from paired DO concentration, water temperature and site elevation; salinity and measured barometric pressure were unavailable.",
            "thresholds": ERS_THRESHOLDS,
        },
        "quality_policy": {"note": "Provisional display filter; raw downloads are unchanged.", "included": sorted(DISPLAY_QUALITY_CODES, key=int), "excluded": sorted(EXCLUDED_QUALITY_CODES, key=int)},
        "sites": availability_sites,
    }

    write_csv(OUTPUT_DIR / "spot_observations.csv", ["site_id", "site_name", "datetime", "parameter_code", "parameter_name", "value", "unit", "raw_value", "raw_unit", "temperature_c", "ers_point_status", "qualifier", "quality_code", "quality_text"], sorted(spot_rows, key=lambda row: (row["site_id"], row["parameter_code"], row["datetime"])))
    write_csv(OUTPUT_DIR / "continuous_daily.csv", ["site_id", "date", "parameter_code", "parameter_name", "unit", "value_mean", "value_min", "value_max", "raw_value_mean", "raw_unit", "temperature_c", "ers_point_status", "n_total", "n_usable", "n_flagged", "quality_codes"], daily_rows)
    write_csv(OUTPUT_DIR / "continuous_hourly.csv", ["site_id", "datetime", "parameter_code", "parameter_name", "unit", "value_mean", "value_min", "value_max", "raw_value_mean", "raw_unit", "temperature_c", "ers_point_status", "n_total", "n_usable", "n_flagged", "quality_codes"], hourly_rows)
    write_csv(OUTPUT_DIR / "sites.csv", ["site_id", "name", "short_name", "latitude", "longitude", "source_crs", "easting", "northing", "zone", "elevation_m", "ers_segment", "active", "cease_date", "basin", "site_types", "has_target_data_2024"], sites_rows)
    (OUTPUT_DIR / "availability.json").write_text(json.dumps(availability, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "goulburn_boundary.geojson").write_text(json.dumps(extract_goulburn_boundary(), separators=(",", ":")), encoding="utf-8")
    validation = {
        "source_measurement_rows": total_rows, "target_sites": len(target_site_ids), "ers_sites_assigned": sum(site_id in site_context for site_id in target_site_ids),
        "spot_rows": len(spot_rows), "daily_rows": len(daily_rows), "hourly_rows": len(hourly_rows), "do_saturation_rows": do_saturation_rows, "do_unpaired_rows": do_unpaired_rows,
        "excluded_2025_boundary_rows": boundary_rows, "observed_quality_codes": dict(sorted(observed_quality_codes.items(), key=lambda item: int(item[0]))),
        "undefined_quality_codes": sorted(code for code in observed_quality_codes if code not in quality_definitions), "source_files_modified": False,
    }
    (OUTPUT_DIR / "validation.json").write_text(json.dumps(validation, indent=2), encoding="utf-8")
    print(json.dumps(validation, indent=2))


if __name__ == "__main__":
    main()
