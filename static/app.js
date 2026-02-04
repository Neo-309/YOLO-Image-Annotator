(() => {
  const $ = id => document.getElementById(id)
  let images = []
  let sourceDir = ''
  let destDir = ''
  let idx = 0
  let imgEl = $('image')
  let canvas = $('canvas')
  let ctx = canvas.getContext('2d')
  let currentBoxes = []
  let drawing = false
  let start = {}
  let rotation = 0 // degrees: 0,90,180,270
  let undoStack = []
  let redoStack = []
  let selectedIndex = -1
  let zoom = 1 // zoom level
  let currentFilename = ''
  let panX = 0
  let panY = 0
  let isPanning = false
  let panStartX = 0
  let panStartY = 0

  function setStatus(t){ $('status').innerText = t }

  function updateImageTransform(){
    const transform = `translate(${panX}px, ${panY}px) rotate(${rotation}deg) scale(${zoom})`
    imgEl.style.transform = transform
    canvas.style.transform = transform
  }

  function resizeCanvas(){
    // canvas dims match displayed image bounding box (before rotation)
    canvas.width = imgEl.clientWidth
    canvas.height = imgEl.clientHeight
    drawBoxes()
  }

  window.addEventListener('resize', resizeCanvas)

  imgEl.addEventListener('load', ()=>{
    // fit canvas to displayed image size
    canvas.style.left = imgEl.offsetLeft + 'px'
    canvas.style.top = imgEl.offsetTop + 'px'
    canvas.style.transformOrigin = 'center center'
    imgEl.style.transformOrigin = 'center center'
    resizeCanvas()
    updateImageTransform()
    $('image_info').innerText = `${images.length} images — ${idx+1}/${images.length} | ${currentFilename}`
  })

  function relpathToUrl(rel){
    return `/api/image?source_dir=${encodeURIComponent(sourceDir)}&relpath=${encodeURIComponent(rel)}`
  }

  function drawBoxes(){
    ctx.clearRect(0,0,canvas.width,canvas.height)
    ctx.font = '12px sans-serif'
    for(let i=0;i<currentBoxes.length;i++){
      const b = currentBoxes[i]
      const r = normalizedToDisplayRect(b)
      if(!r) continue
      if(i === selectedIndex){
        ctx.lineWidth = 3
        ctx.strokeStyle = 'yellow'
        ctx.fillStyle = 'rgba(255,255,0,0.18)'
      } else {
        ctx.lineWidth = 2
        ctx.strokeStyle = 'lime'
        ctx.fillStyle = 'rgba(0,255,0,0.15)'
      }
      ctx.fillRect(r.x, r.y, r.w, r.h)
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      ctx.fillStyle = (i===selectedIndex)?'yellow':'lime'
      ctx.fillText(String(b.class), r.x+4, r.y+12)
    }
  }

  function toImageCoords(clientX, clientY){
    // Use getBoundingClientRect which accounts for CSS transforms (including pan)
    const rect = canvas.getBoundingClientRect()
    // Map to canvas internal coordinates
    let x = (clientX - rect.left) / zoom
    let y = (clientY - rect.top) / zoom
    
    // Account for rotation: reverse the rotation around the center
    if(rotation !== 0){
      const cx = canvas.width / 2
      const cy = canvas.height / 2
      const dx = x - cx
      const dy = y - cy
      const angle = (-rotation) * Math.PI / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      x = cx + dx * cos - dy * sin
      y = cy + dx * sin + dy * cos
    }
    return {x, y}
  }

  function normalizedToDisplayRect(box){
    // box: normalized w.r.t original image (not rotated)
    if(!imgEl.naturalWidth || !imgEl.naturalHeight) return null
    const nw = imgEl.naturalWidth, nh = imgEl.naturalHeight
    // original pixel coords
    const bw = box.w * nw
    const bh = box.h * nh
    const cx = box.x * nw
    const cy = box.y * nh

    let cx2, cy2, bw2, bh2
    let dispW = canvas.width, dispH = canvas.height
    if(rotation % 180 === 0){
      // no swap
      if(rotation === 0){ cx2 = cx; cy2 = cy; bw2 = bw; bh2 = bh }
      else { cx2 = nw - cx; cy2 = nh - cy; bw2 = bw; bh2 = bh }
      var scaleX = dispW / nw, scaleY = dispH / nh
    } else {
      // swapped dims
      if(rotation === 90){ cx2 = cy; cy2 = nw - cx; bw2 = bh; bh2 = bw }
      else { cx2 = nh - cy; cy2 = cx; bw2 = bh; bh2 = bw }
      var scaleX = dispW / nh, scaleY = dispH / nw
    }
    const x = (cx2 - bw2/2) * scaleX
    const y = (cy2 - bh2/2) * scaleY
    const w = bw2 * scaleX
    const h = bh2 * scaleY
    return {x, y, w, h}
  }

  function displayRectToNormalized(px, py, pw, ph){
    // inverse: from display pixels (canvas) to normalized original-image coords
    if(!imgEl.naturalWidth || !imgEl.naturalHeight) return null
    const nw = imgEl.naturalWidth, nh = imgEl.naturalHeight
    const dispW = canvas.width, dispH = canvas.height
    let scaleX, scaleY
    if(rotation % 180 === 0){ scaleX = dispW / nw; scaleY = dispH / nh }
    else { scaleX = dispW / nh; scaleY = dispH / nw }

    const cx_disp = px + pw/2
    const cy_disp = py + ph/2
    const cx_rot = cx_disp / scaleX
    const cy_rot = cy_disp / scaleY
    let cx_orig, cy_orig, bw_orig, bh_orig
    if(rotation === 0){ cx_orig = cx_rot; cy_orig = cy_rot; bw_orig = pw/scaleX; bh_orig = ph/scaleY }
    else if(rotation === 90){ cx_orig = nw - cy_rot; cy_orig = cx_rot; bw_orig = ph/scaleY; bh_orig = pw/scaleX }
    else if(rotation === 180){ cx_orig = nw - cx_rot; cy_orig = nh - cy_rot; bw_orig = pw/scaleX; bh_orig = ph/scaleY }
    else { /*270*/ cx_orig = cy_rot; cy_orig = nh - cx_rot; bw_orig = ph/scaleY; bh_orig = pw/scaleX }

    return {x: round(cx_orig / nw), y: round(cy_orig / nh), w: round(bw_orig / nw), h: round(bh_orig / nh)}
  }

  function round(v){ return Math.round(v*10000)/10000 }

  canvas.addEventListener('mousedown', (ev)=>{
    if(!imgEl.src) return
    if(ev.button !== 0) return // only left mouse button
    drawing = true
    const p = toImageCoords(ev.clientX, ev.clientY)
    start = {x: p.x, y: p.y}
  })
  canvas.addEventListener('mousemove', (ev)=>{
    if(!drawing) return
    const p = toImageCoords(ev.clientX, ev.clientY)
    const px = Math.min(start.x, p.x)
    const py = Math.min(start.y, p.y)
    const pw = Math.abs(p.x - start.x)
    const ph = Math.abs(p.y - start.y)
    // draw preview
    drawBoxes()
    ctx.strokeStyle = 'red'
    ctx.fillStyle = 'rgba(255,0,0,0.15)'
    ctx.strokeRect(px, py, pw, ph)
    ctx.fillRect(px, py, pw, ph)
  })
  canvas.addEventListener('mouseup', (ev)=>{
    if(!drawing) return
    drawing = false
    const p = toImageCoords(ev.clientX, ev.clientY)
    const px = Math.min(start.x, p.x)
    const py = Math.min(start.y, p.y)
    const pw = Math.abs(p.x - start.x)
    const ph = Math.abs(p.y - start.y)
    const clickThreshold = 6
    // if very small drag treat as click -> select/deselect box
    if(pw < clickThreshold && ph < clickThreshold){
      let hit = -1
      for(let i=0;i<currentBoxes.length;i++){
        const r = normalizedToDisplayRect(currentBoxes[i])
        if(!r) continue
        if(p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h){ hit = i; break }
      }
      if(hit >= 0){ selectedIndex = hit; drawBoxes(); return }
      selectedIndex = -1; drawBoxes(); return
    }
    pushUndo()
    const ybox = displayRectToNormalized(px, py, pw, ph)
    ybox.class = parseInt($('class_id').value || 0, 10)
    currentBoxes.push(ybox)
    selectedIndex = -1
    drawBoxes()
  })

  function pushUndo(){ undoStack.push(JSON.parse(JSON.stringify(currentBoxes))); if(undoStack.length>100) undoStack.shift(); redoStack = [] }
  function doUndo(){ if(undoStack.length===0) return; redoStack.push(JSON.parse(JSON.stringify(currentBoxes))); currentBoxes = undoStack.pop(); drawBoxes(); }
  function doRedo(){ if(redoStack.length===0) return; undoStack.push(JSON.parse(JSON.stringify(currentBoxes))); currentBoxes = redoStack.pop(); drawBoxes(); }

  $('btn_set_dirs').addEventListener('click', async ()=>{
    sourceDir = $('source_dir').value.trim()
    destDir = $('dest_dir').value.trim()
    if(!sourceDir || !destDir){ setStatus('provide both dirs'); return }
    setStatus('scanning...')
    const res = await fetch('/api/set_dirs', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source_dir:sourceDir,dest_dir:destDir})})
    const j = await res.json()
    if(!res.ok){ setStatus('error: '+(j.error||res.status)); return }
    setStatus(`found ${j.count} images`)
    const list = await (await fetch(`/api/list_images?source_dir=${encodeURIComponent(sourceDir)}`)).json()
    images = list.images || []
    idx = 0
    loadImage()
  })

  async function loadImage(){
    if(images.length===0){ setStatus('no images'); imgEl.src = ''; return }
    const rel = images[idx]
    currentFilename = rel.split('/').pop() || rel
    imgEl.src = relpathToUrl(rel)
    currentBoxes = []
    // clear undo/redo history for new image
    undoStack = []
    redoStack = []
    // reset rotation, zoom, and pan
    rotation = 0
    zoom = 1
    panX = 0
    panY = 0
    $('pan_x_slider').value = 0
    $('pan_y_slider').value = 0
    updateImageTransform()
    // load annotation from destination directory txt file
    try{
      const r = await fetch(`/api/load_annotation?dest_dir=${encodeURIComponent(destDir)}&relpath=${encodeURIComponent(rel)}`)
      const j = await r.json()
      currentBoxes = j.annotations || []
      selectedIndex = -1
      setStatus(`loaded ${rel}`)
      setTimeout(()=>{ resizeCanvas(); drawBoxes() }, 80)
    }catch(e){ selectedIndex = -1; setStatus(`loaded ${rel}`) }
  }

  async function autoSaveAnnotation(){
    if(!sourceDir || !destDir || images.length===0) return
    const rel = images[idx]
    const body = {source_dir:sourceDir, dest_dir:destDir, relpath:rel, annotations: currentBoxes}
    try{ await fetch('/api/save_annotation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}) }catch(e){}
  }

  async function navPrev(){
    if(idx <= 0) return
    await autoSaveAnnotation()
    idx--
    await loadImage()
  }

  async function navNext(){
    if(idx >= images.length-1) return
    await autoSaveAnnotation()
    idx++
    await loadImage()
  }

  $('btn_next').addEventListener('click', navNext)
  $('btn_prev').addEventListener('click', navPrev)

  $('btn_save').addEventListener('click', async ()=>{
    if(!sourceDir || !destDir) { setStatus('set dirs first'); return }
    if(images.length===0){ setStatus('no image'); return }
    const rel = images[idx]
    const body = {source_dir:sourceDir, dest_dir:destDir, relpath:rel, annotations: currentBoxes}
    const res = await fetch('/api/save_annotation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    const j = await res.json()
    if(res.ok) setStatus('saved')
    else setStatus('error: '+(j.error||res.status))
  })

  $('btn_save_project').addEventListener('click', async ()=>{
    const name = $('project_name').value.trim()
    if(!name) { setStatus('project name required'); return }
    const project = {source_dir:sourceDir,dest_dir:destDir,images:images, index: idx}
    const res = await fetch('/api/save_project',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name, project})})
    const j = await res.json()
    if(res.ok) setStatus('project saved')
    else setStatus('error: '+(j.error||res.status))
  })

  $('btn_list_projects').addEventListener('click', async ()=>{
    const j = await (await fetch('/api/list_projects')).json()
    const sel = $('projects_select')
    sel.innerHTML = ''
    for(const p of j.projects||[]){ const o = document.createElement('option'); o.value=p; o.innerText=p; sel.appendChild(o) }
  })

  $('btn_load_project').addEventListener('click', async ()=>{
    const sel = $('projects_select')
    const name = sel.value || $('project_name').value.trim()
    if(!name){ setStatus('choose project'); return }
    const j = await (await fetch(`/api/load_project?name=${encodeURIComponent(name)}`)).json()
    if(j.error){ setStatus('error: '+j.error); return }
    const p = j.project
    sourceDir = p.source_dir || ''
    destDir = p.dest_dir || ''
    images = p.images || []
    idx = p.index || 0
    $('source_dir').value = sourceDir
    $('dest_dir').value = destDir
    $('project_name').value = name
    loadImage()
    setStatus('project loaded')
  })

  // initialize project list
  $('btn_list_projects').click()

  // rotate buttons - rotate image file and reload
  $('btn_rotate_left').addEventListener('click', async ()=>{
    if(!sourceDir || images.length===0) return
    const rel = images[idx]
    const res = await fetch('/api/rotate_image',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source_dir:sourceDir, relpath:rel, direction:'left'})})
    if(res.ok){ 
      // reload image (cache-bust with timestamp)
      rotation = 0
      zoom = 1
      imgEl.src = relpathToUrl(rel) + '&t=' + Date.now()
      updateImageTransform()
      setStatus('rotated left')
    } else {
      const j = await res.json()
      setStatus('error: '+(j.error||res.status))
    }
  })
  $('btn_rotate_right').addEventListener('click', async ()=>{
    if(!sourceDir || images.length===0) return
    const rel = images[idx]
    const res = await fetch('/api/rotate_image',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source_dir:sourceDir, relpath:rel, direction:'right'})})
    if(res.ok){ 
      // reload image (cache-bust with timestamp)
      rotation = 0
      zoom = 1
      imgEl.src = relpathToUrl(rel) + '&t=' + Date.now()
      updateImageTransform()
      setStatus('rotated right')
    } else {
      const j = await res.json()
      setStatus('error: '+(j.error||res.status))
    }
  })

  // undo/redo
  $('btn_undo').addEventListener('click', ()=> doUndo())
  $('btn_redo').addEventListener('click', ()=> doRedo())
  // delete selected
  $('btn_delete').addEventListener('click', ()=>{
    if(selectedIndex>=0){
      pushUndo()
      currentBoxes.splice(selectedIndex,1)
      selectedIndex = -1
      if(images[idx]) annotationsMap[images[idx]] = JSON.parse(JSON.stringify(currentBoxes))
      drawBoxes()
    }
  })
  window.addEventListener('keydown', (e)=>{
    const z = (e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='z'
    if(z){ e.preventDefault(); doUndo(); return }
    const y = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase()==='y' || (e.shiftKey && e.key.toLowerCase()==='z'))
    if(y){ e.preventDefault(); doRedo(); return }
    if(e.key === 'Delete' || e.key === 'Backspace'){
      if(selectedIndex>=0){ e.preventDefault(); pushUndo(); currentBoxes.splice(selectedIndex,1); selectedIndex=-1; if(images[idx]) annotationsMap[images[idx]] = JSON.parse(JSON.stringify(currentBoxes)); drawBoxes(); }
    }
    // nav shortcuts: arrows and a/d
    if(e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a'){ e.preventDefault(); navPrev(); return }
    if(e.key === 'ArrowRight' || e.key.toLowerCase() === 'd'){ e.preventDefault(); navNext(); return }
  })

  // zoom with mouse wheel
  canvas.addEventListener('wheel', (e)=>{
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    zoom *= delta
    zoom = Math.max(0.5, Math.min(3, zoom))
    updateImageTransform()
    resizeCanvas()
  })

  // pan with sliders
  $('pan_x_slider').addEventListener('input', ()=>{
    panX = parseInt($('pan_x_slider').value, 10)
    updateImageTransform()
    resizeCanvas()
  })
  $('pan_y_slider').addEventListener('input', ()=>{
    panY = parseInt($('pan_y_slider').value, 10)
    updateImageTransform()
    resizeCanvas()
  })

  // right-click drag to pan
  canvas.addEventListener('mousedown', (ev)=>{
    if(ev.button === 2){ // right mouse button
      isPanning = true
      panStartX = ev.clientX - panX
      panStartY = ev.clientY - panY
      ev.preventDefault()
    }
  })
  canvas.addEventListener('mousemove', (ev)=>{
    if(isPanning){
      panX = ev.clientX - panStartX
      panY = ev.clientY - panStartY
      $('pan_x_slider').value = panX
      $('pan_y_slider').value = panY
      updateImageTransform()
      resizeCanvas()
    }
  })
  canvas.addEventListener('mouseup', ()=>{
    isPanning = false
  })
  canvas.addEventListener('contextmenu', (ev)=>{ ev.preventDefault() })
})();
