import { useEffect, useRef, useState } from 'react';

export type WorkspaceView = { page: string; selected: string | null; readerId: string | null; publishId: string | null; preview: boolean; subjectForm: boolean };
export type ListPosition = { query: string; filter: string; scroll: number };
type Entry = { view: WorkspaceView; position: ListPosition };
type Options = {
  identity: string | null; view: WorkspaceView; position: ListPosition;
  allowedPages: readonly string[];
  restore: (view: WorkspaceView, position: ListPosition) => void;
  mayLeave: (next: WorkspaceView) => Promise<boolean>;
};
const keyOf = (v: WorkspaceView) => JSON.stringify(v);
/** History holds only an opaque index. Record text and search terms stay in memory. */
export function useWorkspaceHistory(options: Options) {
  const latest = useRef(options);
  useEffect(()=>{latest.current=options;});
  const owner = useRef('');
  const identity = useRef<string | null>(null);
  const entries = useRef<Entry[]>([]);
  const index = useRef(0);
  const expected = useRef('');
  const returning = useRef<(() => void) | null>(null);
  const bypass = useRef<number | null>(null);
  const pending = useRef(false);
  const [canBack, setCanBack] = useState(false);
  const viewKey = keyOf(options.view);
  const storageKey = (id: string) => `carebridge.last-page.v1:${id}`;
  function replaceTag() { history.replaceState({workspaceNavigation:{owner:owner.current,index:index.current}}, ''); }
  function savePage(page: string) {
    if(identity.current) try { sessionStorage.setItem(storageKey(identity.current),page); } catch { /* optional preference */ }
  }
  useEffect(() => {
    const options=latest.current;
    // Browser history is an external system; synchronizing its position updates the back control.
    // oxlint-disable-next-line react/set-state-in-effect
    if (!options.identity) { identity.current=null;entries.current=[];setCanBack(false);return; }
    if(identity.current !== options.identity) {
      identity.current=options.identity;owner.current=crypto.randomUUID();index.current=0;
      returning.current=null;bypass.current=null;pending.current=false;
      let page=options.view.page;
      try { const stored=sessionStorage.getItem(storageKey(options.identity)); if(stored && options.allowedPages.includes(stored))page=stored; } catch { /* optional preference */ }
      const view={...options.view,page,selected:null,readerId:null,publishId:null,preview:false,subjectForm:false};
      const position={query:'',filter:'all',scroll:0};
      entries.current=[{view,position}];expected.current=keyOf(view);replaceTag();setCanBack(false);
      if(keyOf(view)!==viewKey)options.restore(view,position);
      return;
    }
    if(expected.current===viewKey) return;
    // Save the outgoing page position before recording the next view.
    entries.current=entries.current.slice(0,index.current+1);
    entries.current.push({view:{...options.view},position:{...options.position,scroll:window.scrollY}});
    index.current++;expected.current=viewKey;
    history.pushState({workspaceNavigation:{owner:owner.current,index:index.current}},'');
    savePage(options.view.page);setCanBack(true);
  }, [options.identity, viewKey]);
  useEffect(() => {
    const options=latest.current;
    // Context changes update the current entry without generating back steps.
    const entry=entries.current[index.current];
    if(entry && keyOf(entry.view)===viewKey)entry.position={...options.position,scroll:window.scrollY};
  }, [options.position.query, options.position.filter, viewKey]);
  useEffect(() => {
    const old=history.scrollRestoration;history.scrollRestoration='manual';
    const scroll=()=>{const entry=entries.current[index.current];if(entry)entry.position.scroll=window.scrollY;};
    const pop=(event:PopStateEvent)=>{
      if(returning.current) { const resume=returning.current;returning.current=null;resume();return; }
      const tag=event.state?.workspaceNavigation;
      if(!identity.current || !tag || tag.owner!==owner.current || !entries.current[tag.index]) {
        // An older login's entries must never restore that account's views.
        if(identity.current)replaceTag();
        return;
      }
      const target=tag.index as number;
      const entry=entries.current[target];
      const apply=()=>{
        index.current=target;expected.current=keyOf(entry.view);savePage(entry.view.page);
        latest.current.restore(entry.view,entry.position);setCanBack(target>0);
      };
      if(bypass.current===target) {bypass.current=null;pending.current=false;apply();return;}
      const delta=index.current-target;
      if(!delta)return;
      const currentOwner=owner.current;
      // Restore the current browser entry while the user decides; cancel keeps Forward intact.
      returning.current=()=>{
        if(pending.current)return;
        pending.current=true;
        void latest.current.mayLeave(entry.view).then(approved=>{
          if(owner.current!==currentOwner || !identity.current)return;
          if(approved){bypass.current=target;history.go(-delta);}else pending.current=false;
        });
      };
      history.go(delta);
    };
    window.addEventListener('popstate',pop);window.addEventListener('scroll',scroll);
    return ()=>{window.removeEventListener('popstate',pop);window.removeEventListener('scroll',scroll);history.scrollRestoration=old;};
  }, []);
  return {
    canBack,
    back: () => { if(index.current>0 && !pending.current)history.back(); },
    closePublication: () => {
      if(index.current<=0 || pending.current)return;
      const id=entries.current[index.current].view.publishId;
      let target=index.current-1;
      while(target>0 && entries.current[target].view.publishId===id)target--;
      history.go(target-index.current);
    },
  };
}
