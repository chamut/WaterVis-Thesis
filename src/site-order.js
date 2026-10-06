export const SITE_ORDER_OPTIONS = [
 ['south-north','Position: south → north'],
 ['north-south','Position: north → south'],
 ['elevation','Elevation: high → low'],
 ['name','Site name: A → Z'],
];

export function compareSitesByOrder(a,b,order) {
 const byName=()=>a.short_name.localeCompare(b.short_name)||a.site_id.localeCompare(b.site_id);
 if(order==='name')return byName();
 const field=order==='elevation'?'elevation':'latitude';
 const aValid=Number.isFinite(a[field]),bValid=Number.isFinite(b[field]);
 if(aValid!==bValid)return aValid?-1:1;
 if(!aValid)return byName();
 return (order==='south-north'?1:-1)*(a[field]-b[field])||byName();
}
