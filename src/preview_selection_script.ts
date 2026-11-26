// First-script selection relay for opaque HTML frames. The private port only
// answers parent requests with bounded plain text; it has no send or state API.
export const PREVIEW_SELECTION_SCRIPT = `<script id="recurse-preview-selection">(()=>{
  if(parent===window)return;
  const token=location.hash.slice(1);
  if(!/^recurse-(app-state|preview)=[0-9-]{16,160}$/.test(token))return;
  const channel=new MessageChannel(), port=channel.port1;
  if(location.protocol==='blob:')addEventListener('click',(event)=>{
    if(event.defaultPrevented||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const link=event.target instanceof Element?event.target.closest('a[href]'):null;
    const fragment=link?.getAttribute('href');
    if(!fragment?.startsWith('#')||link.hasAttribute('download')||link.target)return;
    const oldURL=location.href;
    try{history.pushState(history.state,'',fragment)}catch{return}
    event.preventDefault();
    let name;try{name=decodeURIComponent(fragment.slice(1))}catch{name=fragment.slice(1)}
    const target=document.getElementById(name)||document.getElementsByName(name)[0];
    if(target)target.scrollIntoView();else if(!name||name==='top')scrollTo(0,0);
    dispatchEvent(new HashChangeEvent('hashchange',{oldURL,newURL:location.href}));
  });
  const selected=()=>{
    const selection=getSelection();
    if(!selection||selection.isCollapsed||!selection.rangeCount)return '';
    const range=selection.getRangeAt(0), root=range.commonAncestorContainer;
    if(!root.isConnected)return '';
    const after=(node)=>{
      for(let depth=0;node&&node!==root&&depth<128;node=node.parentNode,depth++)
        if(node.nextSibling)return node.nextSibling;
      return null;
    };
    let node=range.startContainer, text='', visited=0;
    if(node.nodeType!==3)node=node.childNodes[range.startOffset]||after(node);
    while(node&&text.length<600&&++visited<=4096){
      if(range.comparePoint(node,0)>0)break;
      if(node.nodeType===3&&range.intersectsNode(node)){
        const start=node===range.startContainer?range.startOffset:0;
        const end=node===range.endContainer?range.endOffset:node.length;
        text+=node.textContent.slice(start,Math.min(end,start+600-text.length));
      }
      node=node.firstChild||after(node);
    }
    return text.replace(/\\s+/g,' ').trim();
  };
  port.onmessage=({data,ports})=>{
    if(ports.length||!data||Object.keys(data).length!==2||data.type!=='selection'||!Number.isSafeInteger(data.request)||data.request<1)return;
    port.postMessage({type:'selection',request:data.request,quote:selected()});
  };
  parent.postMessage({type:'recurse-preview-selection:connect',token},'*',[channel.port2]);
  addEventListener('pagehide',()=>{port.postMessage({type:'closed'});port.close()},{once:true});
})()</script>`;
