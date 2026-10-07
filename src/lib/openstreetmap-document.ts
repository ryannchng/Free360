import { COLORS } from '../theme';
import { batteryDisplay } from './battery-display';
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
.avatar-row{position:relative;width:58px;height:76px}
.avatar-column{position:relative;width:58px;text-align:center;filter:drop-shadow(0 3px 4px #20152530)}
.avatar-column:after{content:'';position:absolute;left:20px;top:52px;width:18px;height:18px;background:${COLORS.purple};transform:rotate(45deg);border-radius:4px 4px 8px 4px;z-index:-1;opacity:.7}
.avatar{box-sizing:border-box;width:58px;height:58px;border:3px solid ${COLORS.white};border-radius:21px;display:flex;align-items:center;justify-content:center;color:${COLORS.white};font-size:22px;font-weight:750;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover}
.battery{position:absolute;left:-4px;bottom:-2px;width:40px;height:22px;box-sizing:border-box;border:2px solid currentColor;border-radius:5px;background:white;box-shadow:0 0 0 2px white,0 2px 4px #20152535;display:flex;align-items:center;justify-content:center}
.battery:after{content:'';position:absolute;right:-5px;top:5px;width:3px;height:8px;border-radius:0 2px 2px 0;background:currentColor}
.battery-track{position:absolute;inset:0;border-radius:3px;overflow:hidden}
.battery-fill{display:block;height:100%;opacity:.2;background:currentColor}
.battery-number{position:relative;color:${COLORS.ink};font-size:10px;line-height:16px;font-weight:800;font-variant-numeric:tabular-nums}
.movement{position:absolute;left:48px;top:-18px;white-space:nowrap;background:${COLORS.white};color:${COLORS.ink};font-size:12px;border-radius:16px;padding:8px 12px;font-weight:600;box-shadow:0 2px 8px #20152525}
.stay{position:absolute;left:42px;top:-22px;display:flex;align-items:center;gap:9px;min-width:132px;white-space:nowrap;background:${COLORS.white};border:1px solid #EDEAF0;border-radius:16px;padding:7px 12px 7px 9px;box-shadow:0 2px 8px #20152525;z-index:2}
.stay svg{width:26px;height:30px;flex-shrink:0;filter:drop-shadow(0 1px 1px #37146740)}
.stay-label{color:#8B8593;font-size:13px;line-height:16px}
.stay-time{color:${COLORS.ink};font-size:13px;font-weight:600;line-height:16px}
.stale{opacity:.52}
.home{box-sizing:border-box;background:${COLORS.white};color:${COLORS.purple};border:0;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px #2a0a4a20}
.home svg{width:18px;height:18px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
.leaflet-control-attribution{margin-bottom:294px;margin-left:7px!important;font-size:10px;line-height:14px;background:transparent!important;border-radius:0;padding:0!important;color:${COLORS.muted};text-shadow:0 1px 2px white,0 -1px 2px white}
.leaflet-control-attribution a{color:${COLORS.muted}}
#edge-markers{position:fixed;inset:0;pointer-events:none;z-index:600}
.edge-member{position:absolute;width:36px;height:36px;padding:0;border:3px solid white;border-radius:13px;box-shadow:0 2px 6px #20152530;color:white;font-family:inherit;font-size:16px;font-weight:750;pointer-events:auto;cursor:pointer}
.edge-member img{width:100%;height:100%;object-fit:cover;border-radius:9px}
.edge-member:after{content:'';position:absolute;left:11px;bottom:-11px;width:8px;height:11px;border-radius:7px 7px 7px 2px;background:${COLORS.purple};border:2px solid white;box-shadow:0 1px 3px #20152520}
.edge-member:focus-visible{outline:3px solid ${COLORS.purple};outline-offset:2px}
</style></head><body><div id="map"></div><div id="edge-markers"></div><script>${leaflet.js}</script><script>
(function(){
  var batteryDisplay=${batteryDisplay.toString()};
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
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,noWrap:true,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'}).addTo(map);
  var markers=L.layerGroup().addTo(map), trail=L.layerGroup().addTo(map);
  var currentData={members:[],bottomInset:286,topInset:72};
  var pinSvg='<svg viewBox="0 0 28 34" aria-hidden="true"><defs><linearGradient id="pin" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#B887FF"/><stop offset=".5" stop-color="#8C4FFF"/><stop offset="1" stop-color="#53229D"/></linearGradient></defs><path d="M14 2C7 2 3.5 7 4.5 13c.8 5 4.5 11.8 7.2 16.6 1 1.7 3.6 1.7 4.6 0C19 24.8 22.7 18 23.5 13 24.5 7 21 2 14 2Z" fill="url(#pin)"/><ellipse cx="13.5" cy="11" rx="4" ry="4.5" fill="white"/><path d="M8 7c1-2 2.8-3 5-3" fill="none" stroke="#DEC5FF" stroke-width="2" stroke-linecap="round"/></svg>';
  function send(message){
    if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else window.parent.postMessage({free360Map:message},'*');
  }
  function point(c){return [c.latitude,c.longitude];}
  function valid(c){return c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude) && Math.abs(c.latitude)<=90 && Math.abs(c.longitude)<=180;}
  function updateEdges(){
    var host=document.getElementById('edge-markers');host.replaceChildren();
    var size=map.getSize(), left=20, right=size.x-20;
    var top=Math.max(92,currentData.topInset+20), bottom=size.y-currentData.bottomInset-58;
    if(right<=left || bottom<=top)return;
    var center={x:(left+right)/2,y:(top+bottom)/2};
    var used={left:[],right:[],top:[],bottom:[]};
    currentData.members.forEach(function(member){
      if(!valid(member.coordinate))return;
      var p=map.latLngToContainerPoint(point(member.coordinate));
      if(p.x>=left && p.x<=right && p.y>=top && p.y<=bottom)return;
      var dx=p.x-center.x,dy=p.y-center.y;
      var tx=dx>0?(right-center.x)/dx:dx<0?(left-center.x)/dx:Infinity;
      var ty=dy>0?(bottom-center.y)/dy:dy<0?(top-center.y)/dy:Infinity;
      var t=Math.min(tx,ty),x=center.x+dx*t,y=center.y+dy*t;
      var edge=tx<ty?(dx>0?'right':'left'):(dy>0?'bottom':'top');
      var vertical=edge==='left'||edge==='right',pos=vertical?y:x;
      var low=vertical?top:left,high=vertical?bottom:right;
      var occupied=used[edge];
      for(var i=0;i<occupied.length;i++){if(Math.abs(pos-occupied[i])<42)pos=occupied[i]+42;}
      if(pos>high){pos=vertical?y:x;for(var j=0;j<occupied.length;j++){if(Math.abs(pos-occupied[j])<42)pos=occupied[j]-42;}}
      pos=Math.max(low,Math.min(high,pos));occupied.push(pos);
      if(vertical)y=pos;else x=pos;
      var button=document.createElement('button');button.className='edge-member'+(member.stale?' stale':'');
      button.style.left=(x-18)+'px';button.style.top=(y-18)+'px';button.style.backgroundColor=member.color;
      button.title=member.name+' · Out of view';button.setAttribute('aria-label','View '+member.name+', out of view');
      button.textContent=member.initials.slice(0,1);
      if(typeof member.avatar==='string' && /^data:image\\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(member.avatar)){
        var image=document.createElement('img');image.src=member.avatar;image.alt=member.name;button.textContent='';button.appendChild(image);
      }
      button.addEventListener('click',function(){map.fitBounds([point(member.coordinate),point(member.coordinate)],{maxZoom:map.getZoom(),paddingTopLeft:[80,currentData.topInset+40],paddingBottomRight:[80,currentData.bottomInset+44],animate:true});send({type:'member',id:member.id});});host.appendChild(button);
    });
  }
  var edgeFrame=null;
  function scheduleEdges(){if(edgeFrame!==null)return;edgeFrame=requestAnimationFrame(function(){edgeFrame=null;updateEdges();});}
  map.on('move zoom resize',scheduleEdges);
  function render(data){
    currentData={members:data.members,bottomInset:data.bottomInset||286,topInset:data.topInset||72};
    var highlighted=data.highlightedMemberId || (data.members.find(function(member){return !!member.stayDuration;})||{}).id;
    document.querySelector('.leaflet-control-attribution').style.marginBottom=(currentData.bottomInset+8)+'px';
    markers.clearLayers(); trail.clearLayers();
    data.homes.forEach(function(home){
      if(!valid(home.coordinate))return;
      var el=document.createElement('div');el.className='home';el.innerHTML='<svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></svg>';
      L.marker(point(home.coordinate),{title:home.name+"'s home",icon:L.divIcon({html:el,className:'avatar-marker',iconSize:[32,32],iconAnchor:[16,16]})}).addTo(markers);
    });
    data.members.forEach(function(member){
      if(!valid(member.coordinate))return;
      var row=document.createElement('div');row.className='avatar-row'+(member.stale?' stale':'');
      var column=document.createElement('div');column.className='avatar-column';row.appendChild(column);
      var avatar=document.createElement('div');avatar.className='avatar';avatar.style.backgroundColor=member.color;column.appendChild(avatar);
      if(typeof member.avatar==='string' && /^data:image\\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(member.avatar)){
        var image=document.createElement('img');image.src=member.avatar;image.alt=member.name;avatar.appendChild(image);
      }else avatar.textContent=member.initials.slice(0,1);
      var charge=batteryDisplay(member.battery);
      if(charge){var battery=document.createElement('span');battery.className='battery';battery.title=charge.label+' battery';battery.style.color=charge.color;var track=document.createElement('span');track.className='battery-track';var fill=document.createElement('span');fill.className='battery-fill';fill.style.width=charge.percent+'%';track.appendChild(fill);battery.appendChild(track);var number=document.createElement('span');number.className='battery-number';number.textContent=charge.label;battery.appendChild(number);column.appendChild(battery);}
      // Stationary members send an empty movement string: omit the badge
      // entirely (no pause icon, no km/h bubble) instead of an empty pill.
      if(member.stayDuration && member.id===highlighted){
        var stay=document.createElement('div');stay.className='stay';
        var pin=document.createElement('span');pin.innerHTML=pinSvg;stay.appendChild(pin);
        var copy=document.createElement('div');var label=document.createElement('div');label.className='stay-label';label.textContent='Here for';copy.appendChild(label);
        var duration=document.createElement('div');duration.className='stay-time';duration.textContent=member.stayDuration;copy.appendChild(duration);stay.appendChild(copy);row.appendChild(stay);
      }else if(member.movement){var badge=document.createElement('div');badge.className='movement';badge.textContent=member.movement;row.appendChild(badge);}
      var marker=L.marker(point(member.coordinate),{title:member.name+', '+member.description,zIndexOffset:member.id===highlighted?500:0,icon:L.divIcon({html:row,className:'avatar-marker',iconSize:[58,76],iconAnchor:[29,70]})}).addTo(markers);
      marker.on('click',function(){send({type:'member',id:member.id});});
    });
    var points=data.trail.filter(valid).map(point);
    if(points.length>1){L.polyline(points,{color:data.trailColor,weight:4}).addTo(trail);L.circleMarker(points[0],{radius:5,color:'white',weight:2,fillColor:data.trailColor,fillOpacity:1}).addTo(trail);}
    scheduleEdges();
  }
  window.free360Receive=function(command){
    if(command.type==='render')render(command.data);
    if(command.type==='center' && valid(command.region)){
      var r=command.region;
      // Padding keeps the fitted area clear of the top overlay and bottom card.
      map.fitBounds([[Math.max(-85,r.latitude-r.latitudeDelta/2),r.longitude-r.longitudeDelta/2],[Math.min(85,r.latitude+r.latitudeDelta/2),r.longitude+r.longitudeDelta/2]],{animate:true,maxZoom:17,paddingTopLeft:[80,Math.max(140,currentData.topInset+40)],paddingBottomRight:[80,currentData.bottomInset+44]});
    }
    if(command.type==='trail'){
      var points=command.coordinates.filter(valid).map(point);
      if(points.length>1)map.fitBounds(points,{paddingTopLeft:[80,Math.max(140,currentData.topInset+40)],paddingBottomRight:[80,currentData.bottomInset+44],maxZoom:17,animate:true});
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
