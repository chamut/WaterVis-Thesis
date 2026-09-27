"""Build browser-sized Goulburn 2015–2024 spot-data files without changing the download."""

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
SOURCE_DIR = WORKSPACE_ROOT / "Data" / "goulburn 10 years 8"
ERS_DIR = WORKSPACE_ROOT / "Data" / "ERS data vic"
BOUNDARY_ARCHIVE = WORKSPACE_ROOT / "Data" / "Basin boundaries.zip"
OUTPUT_DIR = PROJECT_ROOT / "public" / "data"
STUDY_START = datetime(2015, 1, 1)
STUDY_END = datetime(2024, 12, 31, 23, 59, 59)

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


def normalise_site_id(value: str) -> str:
    return value.strip().strip('"').strip()


def valid_for_display(row: dict) -> bool:
    try:
        quality = int(row["Quality"].strip())
    except (TypeError, ValueError):
        return False
    return quality < 151 and row["Qualifier"].strip().upper() != "NV"


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


def assess_series(segment: str, parameter_code: str, values: list[float], minimum_count: int = 1) -> dict:
    objective = ERS_THRESHOLDS.get(segment, {}).get(parameter_code)
    stats = {"p25": quantile(values, 0.25), "median": quantile(values, 0.5), "p75": quantile(values, 0.75), "max": max(values) if values else None}
    if not objective or len(values) < minimum_count:
        return {"status": "unavailable", "objective": objective, "statistics": stats, "sample_count": len(values), "minimum_count": minimum_count}
    passes = True
    if "lower" in objective:
        passes &= stats[objective["lower_stat"]] >= objective["lower"]
    if "upper" in objective:
        passes &= stats[objective["upper_stat"]] <= objective["upper"]
    return {
        "status": "within" if passes else "outside",
        "objective": objective,
        "statistics": {key: None if value is None else round(value, 5) for key, value in stats.items()},
        "sample_count": len(values),
        "minimum_count": minimum_count,
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
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    required = [SOURCE_DIR / "data.0.csv", SOURCE_DIR / "SW Metadata.csv", SOURCE_DIR / "Quality codes.csv", ERS_DIR / "WATER_ERS_POLYGON.dbf", ERS_DIR / "WATER_ERS_POLYGON.shp", BOUNDARY_ARCHIVE]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing source files: {missing}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    metadata_rows = list(read_csv(SOURCE_DIR / "SW Metadata.csv"))
    metadata_by_site = {normalise_site_id(row["Site ID"]): row for row in metadata_rows}
    quality_definitions = {row["Quality"].strip(): row["Text"].strip() for row in read_csv(SOURCE_DIR / "Quality codes.csv")}
    ers_features = load_ers_features()
    site_context = {}
    for row in metadata_rows:
        site_id = normalise_site_id(row["Site ID"])
        latitude = parse_dms(row["Latitude"])
        longitude = parse_dms(row["Longitude"])
        site_context[site_id] = {
            "latitude": latitude,
            "longitude": longitude,
            "elevation": float(row["Elevation (m)"] or 0),
            "segment": assign_ers_segment(longitude, latitude, ers_features),
        }

    source_rows = list(read_csv(SOURCE_DIR / "data.0.csv"))
    observed_quality_codes = Counter(row["Quality"].strip() for row in source_rows)
    study_rows = []
    excluded_period_rows = 0
    for row in source_rows:
        timestamp = datetime.strptime(row["Datetime"].strip(), "%Y/%m/%d %H:%M:%S")
        if not (STUDY_START <= timestamp <= STUDY_END):
            excluded_period_rows += 1
            continue
        row = dict(row)
        row["_timestamp"] = timestamp
        row["_site_id"] = normalise_site_id(row["Site ID"])
        study_rows.append(row)

    valid_rows = [row for row in study_rows if valid_for_display(row)]
    keyed = {(row["_site_id"], row["Datetime"].strip(), row["Parameter"].strip()): row for row in valid_rows}
    temperatures = {(site_id, timestamp): float(row["Value"]) for (site_id, timestamp, parameter), row in keyed.items() if parameter == "Water Temperature"}
    direct_tn = {(site_id, timestamp): row for (site_id, timestamp, parameter), row in keyed.items() if parameter == "Nitrogen as Total"}
    tkn = {(site_id, timestamp): row for (site_id, timestamp, parameter), row in keyed.items() if parameter == "Nitrogen as Total Kjeldahl (TKN)"}
    nox = {(site_id, timestamp): row for (site_id, timestamp, parameter), row in keyed.items() if parameter == "Nitrogen as NOx"}

    spot_rows = []
    cell_raw = {}
    target_site_ids = set()
    do_saturation_rows = 0
    do_unpaired_rows = 0
    do_implausible_rows = 0
    direct_tn_rows = 0
    derived_tn_rows = 0

    def add_observation(source: dict, parameter_code: str, display_value: float, raw_value: float, raw_unit: str, temperature: float | None = None, provenance: str = "measured") -> None:
        site_id = source["_site_id"]
        context = site_context[site_id]
        date_time = source["Datetime"].strip()
        quality_code = source["Quality"].strip() if provenance == "measured" else "derived"
        quality_text = quality_definitions.get(quality_code, "Derived from valid TKN and NOx observations")
        target_site_ids.add(site_id)
        cell = cell_raw.setdefault((site_id, parameter_code), {"spot_count": 0, "date_min": date_time, "date_max": date_time, "spot_values": [], "values_by_year": {}})
        cell["spot_count"] += 1
        cell["date_min"] = min(cell["date_min"], date_time)
        cell["date_max"] = max(cell["date_max"], date_time)
        cell["spot_values"].append(display_value)
        cell["values_by_year"].setdefault(str(source["_timestamp"].year), []).append(display_value)
        spot_rows.append({
            "site_id": site_id,
            "site_name": source["Name"].strip(),
            "datetime": source["_timestamp"].isoformat(),
            "parameter_code": parameter_code,
            "parameter_name": PARAMETERS[parameter_code]["label"],
            "value": f"{display_value:.6g}",
            "unit": PARAMETERS[parameter_code]["unit"],
            "raw_value": f"{raw_value:g}",
            "raw_unit": raw_unit,
            "temperature_c": "" if temperature is None else f"{temperature:g}",
            "ers_point_status": classify_point(context["segment"], parameter_code, display_value),
            "qualifier": source["Qualifier"].strip() if provenance == "measured" else "derived",
            "quality_code": quality_code,
            "quality_text": quality_text,
            "provenance": provenance,
        })

    for row in valid_rows:
        parameter_code = canonical_parameter(row["Parameter"])
        if parameter_code not in {"DO", "TP", "TURB", "PH"}:
            continue
        raw_value = float(row["Value"])
        if parameter_code == "DO":
            if raw_value < 0 or raw_value > 25:
                do_implausible_rows += 1
                continue
            temperature = temperatures.get((row["_site_id"], row["Datetime"].strip()))
            if temperature is None:
                do_unpaired_rows += 1
                continue
            display_value = dissolved_oxygen_saturation(raw_value, temperature, site_context[row["_site_id"]]["elevation"])
            do_saturation_rows += 1
            add_observation(row, parameter_code, display_value, raw_value, row["Unit of Measurement"].strip(), temperature)
        else:
            add_observation(row, parameter_code, raw_value, raw_value, row["Unit of Measurement"].strip())

    nitrogen_keys = sorted(set(direct_tn) | (set(tkn) & set(nox)))
    for key in nitrogen_keys:
        if key in direct_tn:
            row = direct_tn[key]
            value = float(row["Value"])
            add_observation(row, "TN", value, value, row["Unit of Measurement"].strip(), provenance="measured")
            direct_tn_rows += 1
        else:
            tkn_row = tkn[key]
            value = float(tkn_row["Value"]) + float(nox[key]["Value"])
            add_observation(tkn_row, "TN", value, value, "mg/L", provenance="TKN + NOx")
            derived_tn_rows += 1

    sites_rows = []
    for site_id in sorted(target_site_ids):
        source = metadata_by_site[site_id]
        context = site_context[site_id]
        sites_rows.append({
            "site_id": site_id,
            "name": source["Name"].strip(),
            "short_name": source["Short Name"].strip() or source["Name"].strip(),
            "latitude": f"{context['latitude']:.7f}",
            "longitude": f"{context['longitude']:.7f}",
            "source_crs": source["Geographic Coordinate System"].strip(),
            "easting": source["Easting"].strip(),
            "northing": source["Northing"].strip(),
            "zone": source["Zone"].strip(),
            "elevation_m": f"{context['elevation']:g}",
            "ers_segment": context["segment"],
            "active": source["Active"].strip().lower(),
            "cease_date": source["Cease date"].strip(),
            "basin": source["Basin"].strip(),
            "site_types": source["Site types"].strip(),
            "has_target_data": "true",
        })

    availability_sites = {}
    for site_id in sorted(target_site_ids):
        site_parameters = {}
        for parameter_code in PARAMETERS:
            raw = cell_raw.get((site_id, parameter_code))
            if not raw:
                continue
            values = raw["spot_values"]
            annual_assessments = {
                year: assess_series(site_context[site_id]["segment"], parameter_code, year_values, minimum_count=11)
                for year, year_values in sorted(raw["values_by_year"].items())
            }
            eligible_years = [year for year, result in annual_assessments.items() if result["status"] != "unavailable"]
            latest_assessment = annual_assessments[max(eligible_years)] if eligible_years else assess_series(site_context[site_id]["segment"], parameter_code, [], minimum_count=11)
            site_parameters[parameter_code] = {
                "regime": "spot",
                "unit": PARAMETERS[parameter_code]["unit"],
                "spot_count": raw["spot_count"],
                "continuous_count": 0,
                "daily_count": 0,
                "date_min": raw["date_min"],
                "date_max": raw["date_max"],
                "summary_value": round(statistics.median(values), 5),
                "summary_source": "spot observations",
                "ers_assessment": latest_assessment,
                "annual_ers_assessments": annual_assessments,
            }
        metadata = metadata_by_site[site_id]
        availability_sites[site_id] = {
            "name": metadata["Short Name"].strip() or metadata["Name"].strip(),
            "active": metadata["Active"].strip().lower() == "true",
            "ers_segment": site_context[site_id]["segment"],
            "parameters": site_parameters,
        }

    availability = {
        "title": "Goulburn 2015–2024 spot-observation availability and provisional ERS screening",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period": {"start": "2015-01-01", "end": "2024-12-31"},
        "source_rows": len(source_rows),
        "excluded_period_rows": excluded_period_rows,
        "parameters": [dict(code=code, **definition) for code, definition in PARAMETERS.items()],
        "temporal_resolutions": {
            "monthly": {"available": True, "source": "client aggregation of spot observations"},
            "seasonal": {"available": True, "source": "client aggregation of spot observations; Australian meteorological seasons"},
            "yearly": {"available": True, "source": "client aggregation of spot observations"},
        },
        "ers": {
            "source": "EPA Victoria Environment Reference Standard, Table 5.8",
            "source_url": "https://www.epa.vic.gov.au/sites/default/files/2025-05/consolidated-ERS.pdf",
            "assessment_note": "Provisional annual screening only. Table 5.8 percentile statistics are calculated separately for each calendar year and require at least 11 observations; objectives remain segment-specific.",
            "do_note": "DO percent saturation is estimated from paired DO concentration, water temperature and site elevation; salinity and measured barometric pressure were unavailable.",
            "tn_note": "Direct total nitrogen is used where available; otherwise TN is derived from paired TKN + NOx at the same site and timestamp.",
            "thresholds": ERS_THRESHOLDS,
        },
        "quality_policy": {"note": "Records with quality codes below 151 are retained except NV qualifiers; raw downloads are unchanged."},
        "sites": availability_sites,
    }

    spot_fields = ["site_id", "site_name", "datetime", "parameter_code", "parameter_name", "value", "unit", "raw_value", "raw_unit", "temperature_c", "ers_point_status", "qualifier", "quality_code", "quality_text", "provenance"]
    write_csv(OUTPUT_DIR / "spot_observations.csv", spot_fields, sorted(spot_rows, key=lambda row: (row["site_id"], row["parameter_code"], row["datetime"])))
    write_csv(OUTPUT_DIR / "continuous_daily.csv", ["site_id", "date", "parameter_code", "parameter_name", "unit", "value_mean", "value_min", "value_max", "raw_value_mean", "raw_unit", "temperature_c", "ers_point_status", "n_total", "n_usable", "n_flagged", "quality_codes"], [])
    write_csv(OUTPUT_DIR / "continuous_hourly.csv", ["site_id", "datetime", "parameter_code", "parameter_name", "unit", "value_mean", "value_min", "value_max", "raw_value_mean", "raw_unit", "temperature_c", "ers_point_status", "n_total", "n_usable", "n_flagged", "quality_codes"], [])
    write_csv(OUTPUT_DIR / "sites.csv", ["site_id", "name", "short_name", "latitude", "longitude", "source_crs", "easting", "northing", "zone", "elevation_m", "ers_segment", "active", "cease_date", "basin", "site_types", "has_target_data"], sites_rows)
    (OUTPUT_DIR / "availability.json").write_text(json.dumps(availability, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "goulburn_boundary.geojson").write_text(json.dumps(extract_goulburn_boundary(), separators=(",", ":")), encoding="utf-8")
    validation = {
        "source_measurement_rows": len(source_rows),
        "study_period_rows": len(study_rows),
        "target_sites": len(target_site_ids),
        "ers_sites_assigned": sum(site_id in site_context for site_id in target_site_ids),
        "spot_rows": len(spot_rows),
        "daily_rows": 0,
        "hourly_rows": 0,
        "do_saturation_rows": do_saturation_rows,
        "do_unpaired_rows": do_unpaired_rows,
        "do_implausible_rows": do_implausible_rows,
        "direct_tn_rows": direct_tn_rows,
        "derived_tn_rows": derived_tn_rows,
        "excluded_period_rows": excluded_period_rows,
        "observed_quality_codes": dict(sorted(observed_quality_codes.items(), key=lambda item: int(item[0]))),
        "undefined_quality_codes": sorted(code for code in observed_quality_codes if code not in quality_definitions),
        "source_files_modified": False,
    }
    (OUTPUT_DIR / "validation.json").write_text(json.dumps(validation, indent=2), encoding="utf-8")
    print(json.dumps(validation, indent=2))


if __name__ == "__main__":
    main()
