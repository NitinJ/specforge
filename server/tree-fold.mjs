// Folding the child rows under a parent, on every page that lists them.
//
// The home page and the shared project page draw the same tree
// (lib/spec-rows.mjs), and both let a reader fold it: the child-count pill on a
// parent row is the toggle, and a folded parent takes everything below it —
// children and grandchildren alike — off the page. The behaviour lives here,
// once, for the reason the list CSS lives in theme.mjs: two copies drift.
//
// A fold hides rows with the `hidden` attribute rather than an inline display,
// because the home page's filters hide rows with an inline display and the two
// have to compose instead of fighting over one style. The attribute is also
// what lets the guide-line CSS find the last VISIBLE child (:has() can see an
// attribute; it cannot see what display a row has).
//
// The state is the reader's, per spec id, in their own localStorage — one key
// per page kind, so the home page and a shared page remember separately.

/**
 * The fold behaviour, as a script body to inline inside a page's own script.
 *
 * Defines sfFoldsRead / sfFoldsWrite / sfFoldsApply and wires the toggle. After
 * a toggle it calls sfFoldsAfter when the host page has set it: the home page
 * recomputes its filter-dependent counts there, a page without filters has no
 * use for it.
 *
 * @param {string} key localStorage key for this page kind
 */
export function treeFoldScript(key) {
  return `
  // ---- folding the child rows under a parent (server/tree-fold.mjs) ----
  var FOLDS_KEY=${JSON.stringify(key)}, sfFoldsAfter=null;
  function sfFoldsRead(){
    try{ var v=JSON.parse(localStorage.getItem(FOLDS_KEY)||'[]'); return Array.isArray(v)?v:[]; }
    catch(e){ return []; }
  }
  function sfFoldsWrite(list){ try{ localStorage.setItem(FOLDS_KEY,JSON.stringify(list)); }catch(e){} }
  /**
   * Show exactly the subtrees that are not folded.
   *
   * A row is hidden when any spec on its data-parent chain is folded. The walk
   * is over the rows the page has, not the store, and the drawn depth cannot
   * answer — a grandchild is drawn at depth 1 (lib/spec-rows.mjs) — so
   * data-parent is the relation to follow. A cycle in the data must not hang it.
   *
   * An empty list unfolds everything, which is how the home page's filters
   * compose: a narrowed list answers a question that cuts across the tree, and
   * a search hit must not stay buried under a parent the reader folded.
   */
  function sfFoldsApply(folded){
    var all=[].slice.call(document.querySelectorAll('li.row[data-id]'));
    var byId={};
    all.forEach(function(r){ byId[r.getAttribute('data-id')]=r; });
    function buried(r){
      var seen={}, p=r.getAttribute('data-parent');
      while(p&&byId[p]&&!seen[p]){
        seen[p]=1;
        if(folded.indexOf(p)!==-1) return true;
        p=byId[p].getAttribute('data-parent');
      }
      return false;
    }
    all.forEach(function(r){
      r.hidden=buried(r);
      var b=r.querySelector('button.kids');
      // The attribute is the state, not the click: a fold applied from storage
      // on load has no click to speak of.
      if(b) b.setAttribute('aria-expanded',folded.indexOf(r.getAttribute('data-id'))===-1?'true':'false');
    });
  }
  document.addEventListener('click',function(e){
    var b=e.target.closest?e.target.closest('button.kids'):null;
    if(!b) return;
    var row=b.closest('li.row'), id=row?row.getAttribute('data-id'):null;
    if(!id) return;
    var folded=sfFoldsRead();
    var at=folded.indexOf(id);
    if(at===-1) folded.push(id); else folded.splice(at,1);
    sfFoldsWrite(folded);
    sfFoldsApply(folded);
    if(typeof sfFoldsAfter==='function') sfFoldsAfter();
  });
`;
}