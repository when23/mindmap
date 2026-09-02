/* ============================================================
   我的脑图主页 — 多脑图 + 折叠 + 标题文件列表
   新增：节点拖拽换父级 / 搜索定位 / 跨脑图复制子树 / 双击内联编辑
   数据模型：
     maps: [{ id, title, data:<tree>, updatedAt }]
     mind: 当前打开的 tree
   节点：{ id, text, fontSize, bold, color, collapsed, children:[] }
   ============================================================ */

const STORAGE_KEY = 'my-mindmaps-v2';
const FONT_DEFAULT = 15;
const H_GAP = 240, V_GAP = 74;
const PAD_TOP = 70, PAD_LEFT = 70; // 内容区留白，避免第一行节点被顶部工具栏遮挡

let idCounter = 1;
const nid = () => 'n' + (idCounter++);

/* ---------- 默认数据 ---------- */
function defaultData() {
  return {
    id: nid(), text: '中心主题', fontSize: 18, bold: true, color: '#ffffff', collapsed: false,
    children: [
      { id: nid(), text: '分支一', fontSize: 15, bold: false, color: '#2b6cff', collapsed: false, children: [
        { id: nid(), text: '子主题 A', fontSize: 15, bold: false, color: '#1f2430', collapsed: false, children: [] },
        { id: nid(), text: '子主题 B', fontSize: 15, bold: false, color: '#1f2430', collapsed: false, children: [] },
      ]},
      { id: nid(), text: '分支二', fontSize: 15, bold: false, color: '#e5484d', collapsed: false, children: [
        { id: nid(), text: '子主题 C', fontSize: 15, bold: false, color: '#1f2430', collapsed: false, children: [] },
      ]},
    ]
  };
}
function newNode(text = '新建主题') {
  return { id: nid(), text, fontSize: FONT_DEFAULT, bold: false, color: '#1f2430', collapsed: false, children: [] };
}

/* ---------- 存储 ---------- */
function loadMaps() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return null;
    data.forEach(m => fixIds(m.data));
    return data;
  } catch (e) { return null; }
}
function fixIds(n) {
  const num = parseInt((n.id || 'n0').slice(1)) || 0;
  idCounter = Math.max(idCounter, num + 1);
  n.children.forEach(fixIds);
}
function saveMaps() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(maps)); } catch (e) {}
}

/* ---------- 运行时状态 ---------- */
let maps = loadMaps() || [{ id: 'm' + Date.now(), title: '我的第一个脑图', data: defaultData(), updatedAt: Date.now() }];
let currentId = maps[0].id;
let mind = getCurrentMap().data;
let selectedId = mind.id;
let dragId = null;          // 拖拽中的节点 id
let clipboard = null;       // 复制的子树（深拷贝）
let undoStack = [];       // 撤回栈（保存 mind 历史快照）
let searchQuery = '';
let wasSearching = false;
let collapsedSnap = {};

function getCurrentMap() { return maps.find(m => m.id === currentId) || maps[0]; }
function persistCurrent() { const m = getCurrentMap(); m.data = mind; m.updatedAt = Date.now(); saveMaps(); }

/* ---------- 脑图列表操作 ---------- */
function setCurrent(id) {
  if (id === currentId) return;
  undoStack.length = 0;
  persistCurrent();
  currentId = id;
  mind = getCurrentMap().data;
  selectedId = mind.id;
  searchQuery = ''; wasSearching = false;
  document.getElementById('txtSearch').value = '';
  document.getElementById('searchResults').innerHTML = '';
  renderList(); render();
}
function newMap() {
  undoStack.length = 0;
  persistCurrent();
  const m = { id: 'm' + Date.now(), title: '未命名脑图 ' + (maps.length + 1), data: defaultData(), updatedAt: Date.now() };
  maps.push(m); currentId = m.id; mind = m.data; selectedId = mind.id;
  saveMaps(); renderList(); render();
}
function deleteMap(id) {
  undoStack.length = 0;
  const idx = maps.findIndex(m => m.id === id);
  if (idx < 0) return;
  if (!confirm(`确定删除脑图「${maps[idx].title}」吗？此操作不可恢复。`)) return;
  maps.splice(idx, 1);
  if (maps.length === 0) maps.push({ id: 'm' + Date.now(), title: '未命名脑图 1', data: defaultData(), updatedAt: Date.now() });
  if (currentId === id) { currentId = maps[0].id; mind = getCurrentMap().data; selectedId = mind.id; }
  saveMaps(); renderList(); render();
}
function renameMap(id, title) {
  const m = maps.find(x => x.id === id);
  if (m) { m.title = title.trim() || '未命名脑图'; saveMaps(); renderList(); }
}

/* ---------- 树工具 ---------- */
function findParent(root, id, parent = null) {
  if (root.id === id) return parent;
  for (const c of root.children) { const r = findParent(c, id, root); if (r !== null) return r; }
  return null;
}
function findNode(root, id) {
  if (root.id === id) return root;
  for (const c of root.children) { const r = findNode(c, id); if (r) return r; }
  return null;
}
function isRoot(id) { return mind.id === id; }
function hasChildren(n) { return n.children.length > 0; }
function collectVisible(n, out = []) { out.push(n); if (hasChildren(n) && !n.collapsed) n.children.forEach(c => collectVisible(c, out)); return out; }
// 判断 nodeId 是否位于 subtreeRoot 的子树内（含自身）
function isWithin(subtreeRoot, id) {
  if (subtreeRoot.id === id) return true;
  return subtreeRoot.children.some(c => isWithin(c, id));
}

/* ---------- 撤回（undo） ---------- */
function pushUndo(snap) {
  undoStack.push(snap || JSON.parse(JSON.stringify(mind)));
  if (undoStack.length > 60) undoStack.shift();
}
function undo() {
  if (!undoStack.length) { toast('没有可撤回的操作'); return; }
  mind = undoStack.pop();
  if (!findNode(mind, selectedId)) selectedId = mind.id;
  render();
}
// 连续输入控件（文字/字号/颜色）：焦点时记快照，首次变更才入栈，避免每次按键都入栈
let _editSnap = null, _editPushed = false;
function beginEditSnap() { _editSnap = JSON.parse(JSON.stringify(mind)); _editPushed = false; }
function commitEditSnap() { if (!_editPushed) { pushUndo(_editSnap); _editPushed = true; } }
function endEditSnap() { _editSnap = null; _editPushed = false; }

/* ---------- 增删改 ---------- */
function addChild(id) {
  const node = findNode(mind, id); if (!node) return;
  node.collapsed = false;
  const child = newNode(); pushUndo(); node.children.push(child);
  selectedId = child.id; render();
}
function addSibling(id) {
  if (isRoot(id)) { addChild(id); return; }
  const parent = findParent(mind, id);
  const idx = parent.children.findIndex(c => c.id === id);
  const sib = newNode(); pushUndo(); parent.children.splice(idx + 1, 0, sib);
  selectedId = sib.id; render();
}
function addParent(id) {
  const node = findNode(mind, id); if (!node) return;
  const np = newNode(); pushUndo();
  if (isRoot(id)) { np.children = [mind]; mind = np; }
  else {
    const parent = findParent(mind, id);
    const idx = parent.children.findIndex(c => c.id === id);
    np.children = [node]; parent.children[idx] = np;
  }
  selectedId = np.id; render();
}
function deleteNode(id) {
  if (isRoot(id)) {
    if (!confirm('确定要清空当前脑图的所有节点吗？')) return;
    pushUndo();
    mind = { id: nid(), text: '中心主题', fontSize: 18, bold: true, color: '#ffffff', collapsed: false, children: [] };
    selectedId = mind.id; render(); return;
  }
  const parent = findParent(mind, id);
  const idx = parent.children.findIndex(c => c.id === id);
  pushUndo();
  parent.children.splice(idx, 1);
  selectedId = parent.id; render();
}
function moveNode(id, dir) {
  if (isRoot(id)) return;
  const parent = findParent(mind, id);
  const arr = parent.children;
  const i = arr.findIndex(c => c.id === id);
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  pushUndo();
  [arr[i], arr[j]] = [arr[j], arr[i]];
  render();
}
function toggleCollapse(id) {
  const node = findNode(mind, id);
  if (node && hasChildren(node)) { node.collapsed = !node.collapsed; render(); }
}

/* ---------- 拖拽换父级 ---------- */
function reparent(dragId, targetId) {
  if (!dragId || !targetId || dragId === targetId) return;
  const dragNode = findNode(mind, dragId);
  const target = findNode(mind, targetId);
  if (!dragNode || !target) return;
  if (isRoot(dragId)) { toast('根节点不能移动'); return; }
  if (isWithin(dragNode, targetId)) { toast('不能拖到自己的子节点上'); return; }
  const dp = findParent(mind, dragId);
  pushUndo();
  dp.children.splice(dp.children.indexOf(dragNode), 1);
  target.collapsed = false;
  target.children.push(dragNode);
  selectedId = dragId;
  render();
}

/* ---------- 复制 / 粘贴子树（可跨脑图） ---------- */
function deepClone(node) {
  return {
    id: nid(), text: node.text, fontSize: node.fontSize, bold: node.bold, color: node.color, collapsed: false,
    children: node.children.map(deepClone)
  };
}
function copySubtree() {
  const node = findNode(mind, selectedId);
  if (!node) return;
  clipboard = deepClone(node);
  toast('已复制子树：' + node.text);
}
function pasteSubtree() {
  if (!clipboard) { toast('剪贴板为空，请先复制一个子树'); return; }
  const target = findNode(mind, selectedId) || mind;
  const copy = deepClone(clipboard);
  target.collapsed = false;
  pushUndo();
  target.children.push(copy);
  selectedId = copy.id;
  render();
}

/* ---------- 搜索 ---------- */
function expandAll(n) { n.children.forEach(c => { c.collapsed = false; expandAll(c); }); }
function snapshotCollapsed(n, map = {}) { map[n.id] = n.collapsed; n.children.forEach(c => snapshotCollapsed(c, map)); return map; }
function restoreCollapsed(n, map) { if (map[n.id] !== undefined) n.collapsed = map[n.id]; n.children.forEach(c => restoreCollapsed(c, map)); }

function applySearchHighlight() {
  const q = searchQuery.toLowerCase();
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = '';
  if (!q) { document.querySelectorAll('.node').forEach(n => n.classList.remove('search-hit', 'search-focus')); return; }
  document.querySelectorAll('.node').forEach(el => {
    const node = findNode(mind, el.dataset.id);
    const hit = node && node.text.toLowerCase().includes(q);
    el.classList.toggle('search-hit', !!hit);
    if (hit) {
      const item = document.createElement('div');
      item.className = 'search-result';
      item.textContent = (el.classList.contains('root') ? '★ ' : '• ') + node.text;
      item.addEventListener('click', () => {
        selectedId = node.id;
        document.querySelectorAll('.node').forEach(n => n.classList.remove('selected'));
        el.classList.add('selected');
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        el.classList.add('search-focus');
        setTimeout(() => el.classList.remove('search-focus'), 1300);
      });
      resultsEl.appendChild(item);
    }
  });
  if (!resultsEl.children.length) resultsEl.innerHTML = '<div class="search-empty">无匹配</div>';
}

/* ---------- 布局与渲染 ---------- */
function computeLayout(root) {
  let nextY = PAD_TOP;
  const assign = (node, depth) => {
    node._x = depth * H_GAP + PAD_LEFT;
    if (!hasChildren(node) || node.collapsed) { node._y = nextY; nextY += V_GAP; }
    else {
      node.children.forEach(c => assign(c, depth + 1));
      node._y = (node.children[0]._y + node.children[node.children.length - 1]._y) / 2;
    }
  };
  assign(root, 0);
}

function render() {
  computeLayout(mind);
  const nodesEl = document.getElementById('nodes');
  const linksEl = document.getElementById('links');
  nodesEl.innerHTML = ''; linksEl.innerHTML = '';

  const visible = collectVisible(mind);

  // 居中布局：把中心主题放到画布左侧约 22%、垂直居中，避免内容偏顶/偏边
  // 首屏布局未稳时 wrap 尺寸可能为 0，此时跳过居中（保留 PAD 起始），
  // 待 requestAnimationFrame / window.load 重新渲染时再居中，避免刷新后位置错乱
  const wrap = document.getElementById('canvasWrap');
  const availW = wrap.clientWidth, availH = wrap.clientHeight;
  if (availW && availH) {
    const minX = Math.min(...visible.map(n => n._x));
    const maxX = Math.max(...visible.map(n => n._x));
    const minY = Math.min(...visible.map(n => n._y));
    const maxY = Math.max(...visible.map(n => n._y));
    let sx, sy;
    const contentW = (maxX - minX) + 320;
    const contentH = (maxY - minY) + 44;
    if (contentW <= availW) sx = Math.max(PAD_LEFT - minX, Math.round(availW * 0.22) - mind._x);
    else sx = PAD_LEFT - minX;
    if (contentH <= availH) sy = (availH - contentH) / 2 - minY;
    else sy = PAD_TOP - minY;
    visible.forEach(n => { n._x += sx; n._y += sy; });
  }

  visible.forEach(n => {
    const div = document.createElement('div');
    div.className = 'node' + (isRoot(n.id) ? ' root' : '') + (n.id === selectedId ? ' selected' : '');
    div.style.fontSize = n.fontSize + 'px';
    div.style.fontWeight = n.bold ? '700' : '400';
    div.style.color = n.color;
    div.dataset.id = n.id;
    div.setAttribute('draggable', 'true');
    div.style.left = n._x + 'px';
    div.style.top = n._y + 'px';

    const txt = document.createElement('span');
    txt.className = 'node-text';
    txt.textContent = n.text || '（空）';
    div.appendChild(txt);

    if (hasChildren(n)) {
      const t = document.createElement('span');
      t.className = 'toggle';
      t.textContent = n.collapsed ? n.children.length : '−';
      t.title = n.collapsed ? '展开' : '折叠';
      t.addEventListener('click', e => { e.stopPropagation(); toggleCollapse(n.id); });
      div.appendChild(t);
    }

    // 双击节点任意位置 → 内联编辑（折叠开关除外）
    div.addEventListener('dblclick', e => {
      if (e.target.classList.contains('toggle')) return;
      e.stopPropagation();
      enterEdit(n, txt, div);
    });

    nodesEl.appendChild(div);
  });

  // 量尺寸、精修位置、画连线
  let maxRight = 0, maxBottom = 0;
  visible.forEach(n => {
    const el = nodesEl.querySelector(`[data-id="${n.id}"]`);
    n._w = el.offsetWidth; n._h = el.offsetHeight;
    el.style.top = (n._y - n._h / 2) + 'px';
    maxRight = Math.max(maxRight, n._x + n._w);
    maxBottom = Math.max(maxBottom, n._y + n._h / 2);

    if (!isRoot(n.id)) {
      const p = findParent(mind, n.id);
      const sx = p._x + p._w, sy = p._y, cx = n._x, cy = n._y;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${sx} ${sy} C ${sx + 50} ${sy}, ${cx - 50} ${cy}, ${cx} ${cy}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#b9c3d6');
      path.setAttribute('stroke-width', '2');
      linksEl.appendChild(path);
    }
  });

  const W = Math.max(maxRight + 80, 800), H = Math.max(maxBottom + 80, 600);
  nodesEl.style.width = W + 'px'; nodesEl.style.height = H + 'px';
  linksEl.setAttribute('width', W); linksEl.setAttribute('height', H);
  linksEl.style.width = W + 'px'; linksEl.style.height = H + 'px';

  syncToolbar();
  if (searchQuery) applySearchHighlight();
  persistCurrent();
}

/* ---------- 内联编辑 ---------- */
function enterEdit(node, txtEl, divEl) {
  selectedId = node.id;
  document.querySelectorAll('.node').forEach(n => n.classList.remove('selected'));
  divEl.classList.add('selected');
  txtEl.contentEditable = 'true';
  txtEl.classList.add('editing');
  divEl.setAttribute('draggable', 'false');
  txtEl.focus();
  const range = document.createRange();
  range.selectNodeContents(txtEl);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);

  const finish = () => {
    txtEl.contentEditable = 'false';
    txtEl.classList.remove('editing');
    const newText = (txtEl.textContent || '').trim() || '（空）';
    if (newText !== node.text) { pushUndo(); node.text = newText; }
    else { node.text = newText; }
    divEl.setAttribute('draggable', 'true');
    txtEl.removeEventListener('blur', finish);
    txtEl.removeEventListener('keydown', onKey);
    render();
  };
  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); txtEl.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); txtEl.blur(); }
  };
  txtEl.addEventListener('blur', finish);
  txtEl.addEventListener('keydown', onKey);
}

/* ---------- 节点选中（轻量，不重建 DOM，避免打断双击） ---------- */
function selectNode(id) {
  selectedId = id;
  document.querySelectorAll('.node').forEach(n => n.classList.toggle('selected', n.dataset.id === id));
  syncToolbar();
}

/* ---------- 工具栏同步 ---------- */
function syncToolbar() {
  const node = findNode(mind, selectedId) || mind;
  document.getElementById('txtTitle').value = getCurrentMap().title;
  document.getElementById('txtText').value = node.text;
  document.getElementById('rngSize').value = node.fontSize;
  document.getElementById('sizeVal').textContent = node.fontSize;
  const boldBtn = document.getElementById('btnBold');
  boldBtn.style.fontWeight = node.bold ? '800' : '400';
  boldBtn.classList.toggle('primary', node.bold);
  document.getElementById('colColor').value = node.color;
}

/* ---------- 脑图列表渲染 ---------- */
function renderList() {
  const list = document.getElementById('mapList');
  list.innerHTML = '';
  document.getElementById('mapCount').textContent = `(${maps.length})`;
  maps.forEach(m => {
    const item = document.createElement('div');
    item.className = 'map-item' + (m.id === currentId ? ' active' : '');
    item.dataset.id = m.id;

    const ico = document.createElement('span'); ico.className = 'map-ico'; ico.textContent = '📁';
    const name = document.createElement('span'); name.className = 'map-name'; name.textContent = m.title;
    const del = document.createElement('span'); del.className = 'map-del'; del.textContent = '×'; del.title = '删除';
    item.append(ico, name, del);

    item.addEventListener('click', e => { if (e.target === del) return; setCurrent(m.id); });
    del.addEventListener('click', e => { e.stopPropagation(); deleteMap(m.id); });
    name.addEventListener('dblclick', e => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.className = 'map-rename';
      input.value = m.title;
      name.replaceWith(input);
      input.focus(); input.select();
      const commit = () => renameMap(m.id, input.value);
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
    });
    list.appendChild(item);
  });
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  document.getElementById('btnNewMap').onclick = newMap;

  // 选中节点（轻量：只切样式、不重建 DOM，避免打断双击编辑）
  document.getElementById('nodes').addEventListener('click', e => {
    const el = e.target.closest('.node'); if (!el) return;
    if (e.target.classList.contains('toggle')) return;
    if (e.target.isContentEditable) return;
    selectNode(el.dataset.id);
  });

  // 拖拽换父级
  const nodesEl = document.getElementById('nodes');
  nodesEl.addEventListener('dragstart', e => {
    if (e.target.isContentEditable) { e.preventDefault(); return; }
    const el = e.target.closest('.node'); if (!el) return;
    if (e.target.classList && e.target.classList.contains('toggle')) { e.preventDefault(); return; }
    dragId = el.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    el.classList.add('dragging');
  });
  nodesEl.addEventListener('dragend', () => {
    document.querySelectorAll('.node').forEach(n => n.classList.remove('dragging', 'drop-target'));
  });
  nodesEl.addEventListener('dragover', e => {
    const el = e.target.closest('.node'); if (!el) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (el.dataset.id !== dragId) el.classList.add('drop-target');
  });
  nodesEl.addEventListener('dragleave', e => {
    const el = e.target.closest('.node'); if (el) el.classList.remove('drop-target');
  });
  nodesEl.addEventListener('drop', e => {
    const el = e.target.closest('.node'); if (!el) return;
    e.preventDefault();
    const targetId = el.dataset.id;
    el.classList.remove('drop-target');
    reparent(dragId, targetId);
    dragId = null;
  });

  // 结构按钮
  document.getElementById('btnChild').onclick = () => addChild(selectedId);
  document.getElementById('btnParent').onclick = () => addParent(selectedId);
  document.getElementById('btnSibling').onclick = () => addSibling(selectedId);
  document.getElementById('btnUp').onclick = () => moveNode(selectedId, -1);
  document.getElementById('btnDown').onclick = () => moveNode(selectedId, 1);
  document.getElementById('btnDelete').onclick = () => deleteNode(selectedId);
  document.getElementById('btnCopy').onclick = copySubtree;
  document.getElementById('btnPaste').onclick = pasteSubtree;
  document.getElementById('btnUndo').onclick = undo;

  // 工具栏内输入框（作为内联编辑的补充）
  const txtTextEl = document.getElementById('txtText');
  txtTextEl.addEventListener('focus', beginEditSnap);
  txtTextEl.addEventListener('input', e => {
    const node = findNode(mind, selectedId);
    if (node) { node.text = e.target.value; commitEditSnap(); render(); }
  });
  txtTextEl.addEventListener('blur', endEditSnap);
  const rngSizeEl = document.getElementById('rngSize');
  rngSizeEl.addEventListener('focus', beginEditSnap);
  rngSizeEl.addEventListener('input', e => {
    const node = findNode(mind, selectedId);
    if (node) { node.fontSize = +e.target.value; document.getElementById('sizeVal').textContent = e.target.value; commitEditSnap(); render(); }
  });
  rngSizeEl.addEventListener('blur', endEditSnap);
  document.getElementById('btnBold').onclick = () => { const n = findNode(mind, selectedId); if (n) { pushUndo(); n.bold = !n.bold; render(); } };
  const colColorEl = document.getElementById('colColor');
  colColorEl.addEventListener('focus', beginEditSnap);
  colColorEl.addEventListener('input', e => {
    const node = findNode(mind, selectedId); if (node) { node.color = e.target.value; commitEditSnap(); render(); }
  });
  colColorEl.addEventListener('blur', endEditSnap);

  // 标题命名
  document.getElementById('txtTitle').addEventListener('input', e => {
    getCurrentMap().title = e.target.value.trim() || '未命名脑图';
    saveMaps(); renderList();
  });

  // 搜索
  document.getElementById('txtSearch').addEventListener('input', e => {
    const val = e.target.value.trim();
    if (val && !wasSearching) collapsedSnap = snapshotCollapsed(mind);
    searchQuery = val;
    if (val) { expandAll(mind); render(); }
    else if (wasSearching) { restoreCollapsed(mind, collapsedSnap); render(); }
    wasSearching = !!val;
    applySearchHighlight();
  });

  // 导航动作
  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => handleNav(btn.dataset.action)));

  // 操作说明弹窗：关闭交互（点遮罩 / 关闭按钮 / Esc）
  const helpModal = document.getElementById('helpModal');
  helpModal.addEventListener('click', e => { if (e.target === helpModal) closeHelp(); });
  document.getElementById('helpClose').addEventListener('click', closeHelp);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && helpModal.classList.contains('open')) closeHelp(); });

  // 快捷键
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    // 操作说明弹窗打开时，不触发画布快捷键，避免误编辑
    if (document.getElementById('helpModal').classList.contains('open')) return;
    if (e.key === 'Tab') { e.preventDefault(); addChild(selectedId); }
    else if (e.key === 'Enter') { e.preventDefault(); addSibling(selectedId); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteNode(selectedId); }
    else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); moveNode(selectedId, -1); }
    else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); moveNode(selectedId, 1); }
  });

  // 导入
  document.getElementById('fileInput').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        fixIds(data);
        maps.push({ id: 'm' + Date.now(), title: '导入的脑图', data, updatedAt: Date.now() });
        currentId = maps[maps.length - 1].id; mind = data; selectedId = mind.id;
        saveMaps(); renderList(); render();
      } catch (err) { alert('导入失败：文件不是有效的 JSON'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

/* ---------- 导航动作 ---------- */
function handleNav(action) {
  switch (action) {
    case 'exportSVG': exportSVG(); break;
    case 'exportPNG': exportPNG(); break;
    case 'importJSON': document.getElementById('fileInput').click(); break;
    case 'exportJSON': exportJSON(); break;
    case 'reset':
      if (confirm('确定清空当前脑图的所有节点吗？')) {
        pushUndo();
        mind = { id: nid(), text: '中心主题', fontSize: 18, bold: true, color: '#ffffff', collapsed: false, children: [] };
        selectedId = mind.id; render();
      }
      break;
    case 'help': openHelp(); break;
  }
}

/* ---------- 操作说明弹窗 ---------- */
// 想新增说明时，只需往下面的 HELP_GROUPS 数组里加条目即可（keys 为快捷键/按键数组，desc 为说明）
const HELP_GROUPS = [
  { title: '键盘快捷键', items: [
    { keys: ['Tab'], desc: '为选中节点插入下级主题' },
    { keys: ['Enter'], desc: '为选中节点插入同级主题' },
    { keys: ['Delete'], desc: '删除选中节点' },
    { keys: ['Backspace'], desc: '删除选中节点' },
    { keys: ['Alt', '↑'], desc: '上移节点' },
    { keys: ['Alt', '↓'], desc: '下移节点' },
  ]},
  { title: '节点编辑中', items: [
    { keys: ['Enter'], desc: '完成编辑' },
    { keys: ['Esc'], desc: '取消编辑' },
    { keys: ['Shift', 'Enter'], desc: '换行（不结束编辑）' },
  ]},
  { title: '鼠标操作', items: [
    { keys: ['单击'], desc: '选中节点' },
    { keys: ['双击'], desc: '编辑节点文字' },
    { keys: ['拖拽'], desc: '把节点拖到另一个节点上，设为它的子节点' },
    { keys: ['＋/－'], desc: '点击节点右侧圆点，折叠 / 展开子节点' },
  ]},
  { title: '其它', items: [
    { keys: ['↶ 撤回'], desc: '撤销上一步操作（每点一次撤回一环）' },
  ]},
];
function openHelp() {
  const modal = document.getElementById('helpModal');
  const body = document.getElementById('helpBody');
  body.innerHTML = HELP_GROUPS.map(g => `
    <div class="help-group">
      <div class="help-group-title">${g.title}</div>
      ${g.items.map(it => `
        <div class="help-row">
          <span class="help-keys">${it.keys.map(k => `<kbd>${k}</kbd>`).join('')}</span>
          <span class="help-desc">${it.desc}</span>
        </div>`).join('')}
    </div>`).join('');
  modal.classList.add('open');
}
function closeHelp() { document.getElementById('helpModal').classList.remove('open'); }

/* ---------- Toast ---------- */
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ---------- 导出 SVG / PNG ---------- */
function buildSVG() {
  computeLayout(mind);
  const visible = collectVisible(mind);
  let maxRight = 0, maxBottom = 0;
  visible.forEach(n => { maxRight = Math.max(maxRight, n._x + (n._w || 120)); maxBottom = Math.max(maxBottom, n._y + (n._h || 40) / 2); });
  const W = Math.max(maxRight + 80, 800), H = Math.max(maxBottom + 80, 600);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  svg += `<rect width="${W}" height="${H}" fill="#f5f7fb"/>`;
  visible.forEach(n => {
    if (isRoot(n.id)) return;
    const p = findParent(mind, n.id);
    const sx = p._x + (p._w || 120), sy = p._y, cx = n._x, cy = n._y;
    svg += `<path d="M ${sx} ${sy} C ${sx + 50} ${sy}, ${cx - 50} ${cy}, ${cx} ${cy}" fill="none" stroke="#b9c3d6" stroke-width="2"/>`;
  });
  visible.forEach(n => {
    const w = n._w || 120, h = n._h || 40, x = n._x, y = n._y - h / 2;
    const isR = isRoot(n.id);
    const bg = isR ? '#2b6cff' : '#ffffff';
    const stroke = isR ? '#2b6cff' : '#d6dce8';
    const fg = n.color || (isR ? '#ffffff' : '#1f2430');
    svg += `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" ry="10" fill="${bg}" stroke="${stroke}" stroke-width="1.5"/>`;
    svg += `<text x="${x + w / 2}" y="${y + h / 2}" fill="${fg}" font-size="${n.fontSize || 15}" font-weight="${n.bold ? 700 : 400}" font-family="PingFang SC, Microsoft YaHei, sans-serif" text-anchor="middle" dominant-baseline="central">${escapeXML(n.text)}</text></g>`;
  });
  svg += `</svg>`;
  return { svg, W, H };
}
function escapeXML(s) {
  return (s || '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
function download(href, name) {
  const a = document.createElement('a'); a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
function exportSVG() {
  const { svg } = buildSVG();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  download(url, (getCurrentMap().title || 'mindmap') + '.svg');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportPNG() {
  const { svg, W, H } = buildSVG();
  const scale = 2;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      download(url, (getCurrentMap().title || 'mindmap') + '.png');
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* 导出当前脑图为 JSON 文件（与“导入 JSON”对称，形成备份闭环） */
function exportJSON() {
  const map = getCurrentMap();
  const blob = new Blob([JSON.stringify(map.data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  download(url, (map.title || 'mindmap') + '.json');
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- 启动 ---------- */
bindEvents();
renderList();
render();
// 布局稳定后（CSS/字体/滚动条就绪）再渲染一次，确保居中准确，避免刷新后位置错乱
requestAnimationFrame(() => render());
window.addEventListener('load', () => render());
// 窗口尺寸变化时重新居中
window.addEventListener('resize', () => render());
