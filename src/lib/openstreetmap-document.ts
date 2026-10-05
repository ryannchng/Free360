import { COLORS, RADII } from '../theme';
import leaflet from '../../assets/leaflet/bundle.json';

// No remote scripts run in the map: decrypted member data stays in this document.
export const OPENSTREETMAP_HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https://tile.openstreetmap.org; connect-src 'none';">
<style>${leaflet.css}
html,body{width:100%;height:100%;margin:0;overflow:hidden;overscroll-behavior:none;background:${COLORS.mapLand};font-family:'Poppins',ui-rounded,system-ui,sans-serif}
#map{position:fixed;inset:0;width:100%;height:100%;touch-action:none;background:${COLORS.mapPark}}
/* Raster tiles cannot style individual features. Soften only the basemap,
   leaving member photos, icons, trails and controls in their original colors. */
.leaflet-tile-pane{filter:saturate(.42) brightness(1.08) contrast(.86)}
.avatar-marker{background:none;border:0}
.avatar-row{display:flex;align-items:center;gap:8px;width:184px}
.avatar-column{position:relative;width:66px;text-align:center;flex-shrink:0;filter:drop-shadow(0 4px 8px #2a0a4a25)}
.avatar-column:after{content:'';position:absolute;left:27px;top:60px;width:12px;height:12px;background:${COLORS.white};transform:rotate(45deg);border-radius:3px;z-index:-1}
.avatar{box-sizing:border-box;width:66px;height:66px;border:4px solid ${COLORS.white};border-radius:22px;display:flex;align-items:center;justify-content:center;color:${COLORS.white};font-size:25px;font-weight:800;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover}
.battery{position:absolute;right:-6px;bottom:0;background:${COLORS.white};color:${COLORS.mint};font-size:10px;font-weight:800;border-radius:${RADII.pill}px;padding:4px 7px;box-shadow:0 2px 6px #2a0a4a12}
.battery:before{content:'';display:inline-block;width:8px;height:5px;margin-right:3px;border-radius:2px;background:${COLORS.mint}}
.movement{background:${COLORS.white};color:${COLORS.purple};font-size:12px;border-radius:${RADII.pill}px;padding:8px 10px;max-width:108px;font-weight:700;box-shadow:0 4px 12px #2a0a4a18}
.stale{opacity:.52}
.home{box-sizing:border-box;background:${COLORS.white};color:${COLORS.purple};border:0;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px #2a0a4a20}
.home svg{width:18px;height:18px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
.leaflet-control-attribution{margin-bottom:362px!important;margin-left:7px!important;font-size:9px;background:${COLORS.white}!important;border-radius:8px;padding:3px 6px!important;color:${COLORS.muted}}
.leaflet-control-attribution a{color:${COLORS.muted}}
</style></head><body><div id="map"></div><script>${leaflet.js}</script><script>
(function(){
  // Web Mercator tiles end at these latitudes. Keep the entire viewport inside
  // that world, including on tall screens and when zooming all the way out.
  var world=L.latLngBounds([[-85.0511287798066,-180],[85.0511287798066,180]]);
  // Pinch stays anchored at the midpoint between the two fingers (touchZoom
  // focal). Forcing 'center' here zooms around the map center instead, so an
  // off-center pinch appears to drift downward rather than into the fingers.
  // Leaflet's focal handler already resolves the midpoint in container-local
  // coordinates (view offsets) and re-anchors every move (moving centroid).
  // Wheel and double-tap intentionally stay centered to avoid cursor-anchored
  // pans; only touch needs the focal anchor.
  var map=L.map('map',{zoomControl:false,touchZoom:true,doubleClickZoom:'center',scrollWheelZoom:'center',attributionControl:true,maxBounds:world,maxBoundsViscosity:1,bounceAtZoomLimits:false}).setView([39.5,-98.35],3);
  function constrainViewport(){
    map.invalidateSize();
    map.setMinZoom(map.getBoundsZoom(world,true));
    map.panInsideBounds(world,{animate:false});
  }
  constrainViewport();
  map.attributionControl.setPosition('bottomleft');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,noWrap:true,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'}).addTo(map);
  var markers=L.layerGroup().addTo(map), trail=L.layerGroup().addTo(map);
  function send(message){
    if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else window.parent.postMessage({free360Map:message},'*');
  }
  function point(c){return [c.latitude,c.longitude];}
  function valid(c){return c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude) && Math.abs(c.latitude)<=90 && Math.abs(c.longitude)<=180;}
  function render(data){
    markers.clearLayers(); trail.clearLayers();
    data.homes.forEach(function(home){
      if(!valid(home.coordinate))return;
      var el=document.createElement('div');el.className='home';el.textContent='⌂';
      L.marker(point(home.coordinate),{title:home.name+"'s home",icon:L.divIcon({html:el,className:'avatar-marker',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(markers);
    });
    data.members.forEach(function(member){
      if(!valid(member.coordinate))return;
      var row=document.createElement('div');row.className='avatar-row'+(member.stale?' stale':'');
      var column=document.createElement('div');column.className='avatar-column';row.appendChild(column);
      var avatar=document.createElement('div');avatar.className='avatar';avatar.style.backgroundColor=member.color;column.appendChild(avatar);
      if(typeof member.avatar==='string' && /^data:image\\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(member.avatar)){
        var image=document.createElement('img');image.src=member.avatar;image.alt=member.name;avatar.appendChild(image);
      }else avatar.textContent=member.initials;
      if(member.battery!=null){var battery=document.createElement('span');battery.className='battery';battery.textContent=member.battery+'%';column.appendChild(battery);}
      // Stationary members send an empty movement string: omit the badge
      // entirely (no pause icon, no km/h bubble) instead of an empty pill.
      if(member.movement){var badge=document.createElement('div');badge.className='movement';badge.textContent=member.movement;row.appendChild(badge);}
      var marker=L.marker(point(member.coordinate),{title:member.name+', '+member.description,icon:L.divIcon({html:row,className:'avatar-marker',iconSize:[184,86],iconAnchor:[33,35]})}).addTo(markers);
      marker.on('click',function(){send({type:'member',id:member.id});});
    });
    var points=data.trail.filter(valid).map(point);
    if(points.length>1){L.polyline(points,{color:data.trailColor,weight:4}).addTo(trail);L.circleMarker(points[0],{radius:5,color:'white',weight:2,fillColor:data.trailColor,fillOpacity:1}).addTo(trail);}
  }
  window.free360Receive=function(command){
    if(command.type==='render')render(command.data);
    if(command.type==='center' && valid(command.region)){
      var r=command.region;
      // Padding keeps the fitted area clear of the top overlay and bottom card.
      map.fitBounds([[Math.max(-85,r.latitude-r.latitudeDelta/2),r.longitude-r.longitudeDelta/2],[Math.min(85,r.latitude+r.latitudeDelta/2),r.longitude+r.longitudeDelta/2]],{animate:true,maxZoom:17,paddingTopLeft:[80,140],paddingBottomRight:[80,330]});
    }
    if(command.type==='trail'){
      var points=command.coordinates.filter(valid).map(point);
      if(points.length>1)map.fitBounds(points,{paddingTopLeft:[80,140],paddingBottomRight:[80,330],maxZoom:17,animate:true});
    }
  };
  window.addEventListener('message',function(event){if(event.source===window.parent && event.data.free360Command)window.free360Receive(event.data.free360Command);});
  // Report genuine user pan/zoom so the app can suspend auto-framing.
  // Programmatic fits (injectJavaScript/postMessage) produce no DOM gesture,
  // so gating view events on a recent gesture distinguishes the two: taps
  // without movement fire no view event and never count as interaction.
  var lastGestureAt=0;
  function noteGesture(){try{lastGestureAt=Date.now();}catch(noteError){}}
  var mapNode=document.getElementById('map');
  if(mapNode&&mapNode.addEventListener){
    mapNode.addEventListener('touchstart',noteGesture,{passive:true});
    mapNode.addEventListener('mousedown',noteGesture);
    mapNode.addEventListener('wheel',noteGesture,{passive:true});
    mapNode.addEventListener('dblclick',noteGesture);
  }
  if(document.addEventListener)document.addEventListener('keydown',noteGesture);
  function reportIfUserDriven(){if(Date.now()-lastGestureAt<750)send({type:'interacted'});}
  map.on('movestart',reportIfUserDriven);
  map.on('zoomstart',reportIfUserDriven);
  new ResizeObserver(constrainViewport).observe(document.getElementById('map'));
  send({type:'ready'});
})();
</script></body></html>`;
