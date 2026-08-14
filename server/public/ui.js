/* SpecForge shared UI primitives: window.SFUI.
 *
 * One snackbar and one pair of dialogs, used by the home page and by the review
 * layer injected onto every served spec. There used to be two of each and they
 * disagreed on everything that was visible — where a message appears, whether it
 * dismisses itself, whether it can be dismissed at all — and the review layer's
 * destructive actions (unshare, detach) asked nothing before running.
 *
 * Every element is built on demand and appended to <body>, so a page adopts this
 * by loading the file. Nothing has to be in the markup, which is what lets a
 * server-rendered page and an injected layer share it.
 *
 *   SFUI.snack('Saved', {tone:'err', timeout, action:{label, run}}) -> {dismiss}
 *   SFUI.confirm({title, body, ok, danger, onOk})
 *   SFUI.prompt({title, label, value, ok, onOk})   // onOk(trimmed value)
 */
(function () {
  if (window.SFUI) return;

  var DEFAULT_MS = 4000;
  var ERROR_MS = 7000; // a failure is read, not glimpsed

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // jsdom implements no <dialog> behaviour at all, so both calls are guarded: a
  // real browser gets showModal (focus trap, Escape, backdrop) and a test DOM
  // gets the open attribute, which is what showModal reflects anyway.
  function open(d) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  function close(d) { if (d.close) d.close(); else d.removeAttribute('open'); }

  var host = null;
  function snacks() {
    if (!host || !host.isConnected) {
      host = el('div', 'sfui-snacks');
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    return host;
  }

  /**
   * A message at the bottom of the window. Returns a handle so a caller that
   * knows the condition has cleared can take it back down early.
   *
   * It dismisses itself AND carries an ×: a message that only fades is one you
   * can miss, and one that only waits is one you have to clear.
   */
  function snack(text, opts) {
    var o = opts || {};
    var err = o.tone === 'err';
    var box = el('div', 'sfui-snack' + (err ? ' err' : ''));
    box.appendChild(el('span', 'sfui-snack-msg', text));
    if (o.action && o.action.label) {
      var act = el('button', 'sfui-snack-act', o.action.label);
      act.type = 'button';
      act.onclick = function () { dismiss(); if (o.action.run) o.action.run(); };
      box.appendChild(act);
    }
    var x = el('button', 'sfui-snack-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Dismiss');
    x.onclick = function () { dismiss(); };
    box.appendChild(x);
    snacks().appendChild(box);

    var timer = null;
    function dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (box.parentNode) box.parentNode.removeChild(box);
    }
    var ms = o.timeout != null ? o.timeout : (err ? ERROR_MS : DEFAULT_MS);
    if (ms > 0) timer = setTimeout(dismiss, ms);
    return { dismiss: dismiss };
  }

  // One dialog of each kind, reused. Rebuilt if something removed it from the
  // document — an injected layer lives in a page it does not own.
  var confirmDlg = null;
  var promptDlg = null;

  function shell(id, cls) {
    var d = el('dialog', 'sfui-dlg ' + cls);
    d.id = id;
    d.setAttribute('aria-labelledby', id + '-title');
    d.appendChild(el('h3', null, '')).id = id + '-title';
    return d;
  }
  function actions(d, cancelId, okId, okCls) {
    var row = el('div', 'sfui-acts');
    var cancel = el('button', 'sfui-btn', 'Cancel');
    cancel.type = 'button'; cancel.id = cancelId;
    var ok = el('button', 'sfui-btn ' + okCls, 'OK');
    ok.type = 'button'; ok.id = okId;
    row.appendChild(cancel); row.appendChild(ok);
    d.appendChild(row);
    cancel.onclick = function () { close(d); };
    ok.onclick = function () {
      var run = d.sfuiOk;
      close(d);
      if (run) run();
    };
    return { cancel: cancel, ok: ok };
  }

  function buildConfirm() {
    var d = shell('sf-dc', 'sfui-confirm');
    var body = el('p', 'sfui-body');
    body.id = 'sf-dc-body';
    d.appendChild(body);
    var btns = actions(d, 'sf-dc-cancel', 'sf-dc-ok', 'danger');
    document.body.appendChild(d);
    return { d: d, title: d.firstChild, body: body, ok: btns.ok, cancel: btns.cancel };
  }
  function buildPrompt() {
    var d = shell('sf-dp', 'sfui-prompt');
    var lab = el('label', 'sfui-lab');
    lab.id = 'sf-dp-label'; lab.htmlFor = 'sf-dp-input';
    var input = el('input', 'sfui-in');
    input.id = 'sf-dp-input'; input.type = 'text'; input.autocomplete = 'off';
    d.appendChild(lab); d.appendChild(input);
    var btns = actions(d, 'sf-dp-cancel', 'sf-dp-ok', 'primary');
    input.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); btns.ok.click(); }
    };
    document.body.appendChild(d);
    return { d: d, title: d.firstChild, label: lab, input: input, ok: btns.ok, cancel: btns.cancel };
  }

  /** Ask before doing something that cannot be undone from here. */
  function confirmDialog(o) {
    if (!confirmDlg || !confirmDlg.d.isConnected) confirmDlg = buildConfirm();
    var c = confirmDlg;
    c.title.textContent = o.title || 'Are you sure?';
    c.body.textContent = o.body || '';
    c.ok.textContent = o.ok || 'Delete';
    c.ok.className = 'sfui-btn ' + (o.danger === false ? 'primary' : 'danger');
    c.d.sfuiOk = o.onOk;
    open(c.d);
    // Cancel takes focus, not the destructive button: Enter is the reflex that
    // dismisses a dialog you did not read.
    c.cancel.focus();
  }

  /** Ask for one line of text, prefilled — a rename is an edit, not a retype. */
  function promptDialog(o) {
    if (!promptDlg || !promptDlg.d.isConnected) promptDlg = buildPrompt();
    var p = promptDlg;
    p.title.textContent = o.title || 'Rename';
    p.label.textContent = o.label || 'Name';
    p.ok.textContent = o.ok || 'Save';
    p.input.value = o.value || '';
    p.d.sfuiOk = function () {
      var v = p.input.value.trim();
      if (v && v !== o.value && o.onOk) o.onOk(v);
    };
    open(p.d);
    p.input.focus();
    p.input.select();
  }

  /** True while any SFUI dialog is showing — a page's own Escape handling should
   *  stand down, since the dialog is already answering that key. */
  function dialogOpen() { return !!document.querySelector('.sfui-dlg[open]'); }

  window.SFUI = {
    snack: snack,
    confirm: confirmDialog,
    prompt: promptDialog,
    dialogOpen: dialogOpen,
  };
})();
