import leaflet from '../../assets/leaflet/bundle.json';

// No remote scripts run in the map: decrypted member data stays in this document.
export const OPENSTREETMAP_HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https://tile.openstreetmap.org; connect-src 'none';">
<style>${leaflet.css}
html,body{width:100%;height:100%;margin:0;overflow:hidden;overscroll-behavior:none;background:#e6eaf0}
#map{position:fixed;inset:0;width:100%;height:100%;touch-action:none}
.avatar-marker{background:none;border:0}.avatar-row{display:flex;align-items:center;gap:6px;width:184px}
.avatar-column{width:66px;text-align:center}.avatar{box-sizing:border-box;width:66px;height:66px;border:4px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font:bold 23px sans-serif;overflow:hidden;box-shadow:0 3px 7px #28154d40}
.avatar img{width:100%;height:100%;object-fit:cover}.battery,.movement{background:white;color:#16233b;font:12px sans-serif;border-radius:8px;padding:3px 5px}.movement{max-width:108px;font-weight:bold}.stale{opacity:.52}
.home{background:#52cbb0;color:#16233b;border:3px solid white;border-radius:50%;width:24px;height:24px;text-align:center;font:20px sans-serif}
.leaflet-control-attribution{margin-bottom:346px!important;margin-left:7px!important;font-size:8px}
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
      L.marker(point(home.coordinate),{title:home.name+"'s home",icon:L.divIcon({html:el,className:'avatar-marker',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(markers);
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
