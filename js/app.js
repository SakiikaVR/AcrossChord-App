/*!
 * アクロスコード (AcrossChord) — アプリケーションロジック
 * Copyright (c) 2026 SakiikaVR / MIT License
 * デザイン: オンコミ (ON-Comi) / MIT License
 */
'use strict';

/* ============ 状態 ============ */
let notationMode=localStorage.getItem('cv_notation')||'sharp';
let tuningId=localStorage.getItem('cv_tuning')||'std'; if(!TUNINGS[tuningId])tuningId='std';
let accentId=localStorage.getItem('cv_accent')||'blue'; if(!ACCENTS[accentId])accentId='blue';
let themeId=localStorage.getItem('cv_theme')||'light'; if(!THEMES[themeId])themeId='light';
let diagramOn=localStorage.getItem('cv_diagram')!=='off'; // 既定で有効
let powerLowOnly=localStorage.getItem('cv_power_low')==='on'; // パワーコードを低音3弦 (6弦ルート) に固定
let songLibrary=[],playlists=[];
let currentSongId=null,currentPlaylistId=null;
let isSelectionMode=false,isPlaylistSelectionMode=false;
let selectedSongIds=new Set(),selectedPlaylistIds=new Set();
let longPressTimer=null,suppressNextClick=false;
let scrollInterval=null,isScrolling=false,zoomLevel=100;
let audioCtx=null,analyser=null,tunerRaf=null,micStream=null,bridgeTuner=null;
let activePage='library';

const $=id=>document.getElementById(id);

/* ============ UI アイコン (テキストグリフの代わりに SVG を使う) ============ */
const SVG_CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const SVG_CHEVRON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

/* ============ ユーティリティ ============ */
function escapeHTML(str){return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
function M_toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),1800)}
function loadLibrary(){try{songLibrary=JSON.parse(localStorage.getItem('cv_library')||'[]')}catch{songLibrary=[]}}
function saveLibrary(){localStorage.setItem('cv_library',JSON.stringify(songLibrary))}
function loadPlaylists(){try{playlists=JSON.parse(localStorage.getItem('cv_playlists')||'[]')}catch{playlists=[]}}
function savePlaylists(){localStorage.setItem('cv_playlists',JSON.stringify(playlists))}
function getSong(id){return songLibrary.find(s=>s.id===id)}

/* ---- iOSアラート (confirm / prompt) ---- */
function iosConfirm(title,msg='',okText='OK',danger=false){
    return new Promise(resolve=>{
        $('ios-alert-title').textContent=title;
        const m=$('ios-alert-msg');m.textContent=msg;m.style.display=msg?'block':'none';
        $('ios-alert-input').style.display='none';
        const ok=$('ios-alert-ok');ok.textContent=okText;ok.classList.toggle('danger',danger);
        $('ios-alert-overlay').classList.add('show');
        const done=v=>{$('ios-alert-overlay').classList.remove('show');ok.onclick=null;$('ios-alert-cancel').onclick=null;resolve(v)};
        ok.onclick=()=>done(true);
        $('ios-alert-cancel').onclick=()=>done(false);
    });
}
function iosPrompt(title,initial=''){
    return new Promise(resolve=>{
        $('ios-alert-title').textContent=title;
        $('ios-alert-msg').style.display='none';
        const inp=$('ios-alert-input');inp.style.display='block';inp.value=initial;
        const ok=$('ios-alert-ok');ok.textContent='OK';ok.classList.remove('danger');
        $('ios-alert-overlay').classList.add('show');
        setTimeout(()=>inp.focus(),80);
        const done=v=>{$('ios-alert-overlay').classList.remove('show');ok.onclick=null;$('ios-alert-cancel').onclick=null;inp.onkeyup=null;resolve(v)};
        ok.onclick=()=>done(inp.value);
        inp.onkeyup=e=>{if(e.key==='Enter')done(inp.value)};
        $('ios-alert-cancel').onclick=()=>done(null);
    });
}
/* ---- アクションシート ---- */
function actionSheet(title,actions){
    return new Promise(resolve=>{
        const g=$('action-sheet-group');g.innerHTML='';
        if(title){const t=document.createElement('div');t.className='action-sheet-title';t.textContent=title;g.appendChild(t)}
        actions.forEach((a,i)=>{
            const b=document.createElement('button');
            b.className='action-sheet-btn'+(a.danger?' danger':'')+(a.active?' active':'');
            b.innerHTML=`<span>${escapeHTML(a.label)}</span>`+(a.active?`<span class="sheet-check">${SVG_CHECK}</span>`:'');
            b.onclick=()=>done(i);
            g.appendChild(b);
        });
        $('action-sheet-overlay').classList.add('show');
        const done=v=>{$('action-sheet-overlay').classList.remove('show');$('action-sheet-cancel').onclick=null;$('action-sheet-overlay').onclick=null;resolve(v)};
        $('action-sheet-cancel').onclick=()=>done(-1);
        $('action-sheet-overlay').onclick=e=>{if(e.target===$('action-sheet-overlay'))done(-1)};
    });
}

/* ============ ページ切り替え ============ */
function showPage(id){
    activePage=id;
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    $('page-'+id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===(id==='detail'?'library':id)));
    document.body.classList.toggle('hide-nav',id==='edit');
    if(id!=='detail'){closeChordPopup();closeScrollPanel();closeZoomPanel()}
}
document.querySelectorAll('.nav-item').forEach(n=>{
    n.addEventListener('click',()=>{
        const target=n.dataset.page;
        if($('page-edit').classList.contains('active'))return;
        if(target==='library'&&currentSongId&&activePage==='detail'){history.back();return}
        if(activePage==='detail'&&target!=='library'){/* 曲を開いたまま他タブへ */}
        showPage(target);
    });
});

/* ============ 履歴管理 ============ */
window.addEventListener('popstate',e=>restoreState(e.state));
function restoreState(state){
    if($('page-edit').classList.contains('active')){/* 編集破棄で戻る */}
    if(isSelectionMode)exitSelectionMode();
    if(isPlaylistSelectionMode)exitPlaylistSelectionMode();
    closeSongPicker();
    if(!state||!state.mode){_closeSongDetailView();_closePlaylistDetail();return}
    if(state.mode==='song'){_closePlaylistDetail();openSongDetail(state.songId,false);return}
    if(state.mode==='playlist_detail'){_closeSongDetailView();_openPlaylistDetailInternal(state.playlistId);showPage('lists');return}
    if(state.mode==='edit'){enterEditModeInternal();return}
}

/* ============ 五十音インデックス ============ */
function getIndexChar(str){if(!str)return'#';const c=str.charAt(0);if(/[ぁ-んァ-ン]/.test(c)){const h=c.replace(/[ァ-ン]/g,s=>String.fromCharCode(s.charCodeAt(0)-0x60));if(/[あ-お]/.test(h))return'あ';if(/[か-ご]/.test(h))return'か';if(/[さ-ぞ]/.test(h))return'さ';if(/[た-ど]/.test(h))return'た';if(/[な-の]/.test(h))return'な';if(/[は-ぽ]/.test(h))return'は';if(/[ま-も]/.test(h))return'ま';if(/[や-よ]/.test(h))return'や';if(/[ら-ろ]/.test(h))return'ら';if(/[わ-ん]/.test(h))return'わ';return'他'}if(/[a-zA-Z]/.test(c))return c.toUpperCase();return'#'}

/* ============ 曲リスト ============ */
function renderSongList(filter=''){
    const c=$('song-list-container');c.innerHTML='';
    const f=filter.toLowerCase();
    const arr=songLibrary.filter(s=>[s.title,s.artist,s.content].some(v=>String(v||'').toLowerCase().includes(f))).sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),'ja'));
    if(!arr.length){
        c.innerHTML=`<div class="empty-library">
            <svg viewBox="0 0 24 24" class="svg-icon"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            <p>${songLibrary.length?'該当する曲がありません':'ライブラリは空です'}</p>
            <span>${songLibrary.length?'検索条件を変えてみてください':'右上の追加ボタンから新しいコード譜を作成できます'}</span>
        </div>`;
        return;
    }
    let group=null,card=null;
    arr.forEach(s=>{
        const idx=getIndexChar(s.title);
        if(idx!==group){
            group=idx;
            if(card)c.appendChild(card);
            const h=document.createElement('div');h.className='index-header';h.textContent=idx;c.appendChild(h);
            card=document.createElement('div');card.className='song-group';
        }
        const li=document.createElement('div');
        li.className='song-item'+(selectedSongIds.has(s.id)?' selected':'');
        li.addEventListener('touchstart',()=>startLongPress(s.id),{passive:true});
        li.addEventListener('touchend',cancelLongPress,{passive:true});
        li.addEventListener('touchmove',cancelLongPress,{passive:true});
        li.addEventListener('mousedown',()=>startLongPress(s.id));
        li.addEventListener('mouseup',cancelLongPress);
        li.addEventListener('mouseleave',cancelLongPress);
        li.addEventListener('contextmenu',e=>{e.preventDefault();if(!isSelectionMode)enterSelectionMode(s.id)});
        li.onclick=()=>handleItemClick(s.id);
        const icon=escapeHTML((s.title||'?').charAt(0));
        const right=isSelectionMode
            ?(selectedSongIds.has(s.id)?`<div class="song-check">${SVG_CHECK}</div>`:'<div style="width:24px;"></div>')
            :`<div class="settings-chevron">${SVG_CHEVRON}</div>`;
        li.innerHTML=`<div class="song-icon">${icon}</div><div class="song-info"><div class="song-title-list">${escapeHTML(s.title)}</div><div class="song-artist-list">${escapeHTML(s.artist||'No Artist')}</div></div>${right}`;
        card.appendChild(li);
    });
    if(card)c.appendChild(card);
}
function filterSongs(){renderSongList($('song-search').value)}
function startLongPress(id){if(isSelectionMode)return;cancelLongPress();longPressTimer=setTimeout(()=>enterSelectionMode(id),600)}
function cancelLongPress(){clearTimeout(longPressTimer);longPressTimer=null}
function enterSelectionMode(id){suppressNextClick=true;isSelectionMode=true;selectedSongIds.clear();selectedSongIds.add(id);updateSelectionUI();navigator.vibrate?.(50);setTimeout(()=>suppressNextClick=false,500)}
function exitSelectionMode(){isSelectionMode=false;selectedSongIds.clear();updateSelectionUI()}
function handleItemClick(id){
    if(suppressNextClick)return;
    if(isSelectionMode){
        selectedSongIds.has(id)?selectedSongIds.delete(id):selectedSongIds.add(id);
        if(!selectedSongIds.size)exitSelectionMode();else updateSelectionUI();
    }else openSongDetail(id,true);
}
function updateSelectionUI(){
    const anySel=isSelectionMode||isPlaylistSelectionMode;
    $('selection-bar').classList.toggle('show',anySel);
    document.body.classList.toggle('hide-nav',anySel||$('page-edit').classList.contains('active'));
    const n=isSelectionMode?selectedSongIds.size:selectedPlaylistIds.size;
    $('sel-delete-label').textContent=anySel?`削除 (${n})`:'削除';
    renderSongList($('song-search').value);
    renderPlaylistCollection();
}
async function deleteSelectedSongs(){
    if(!selectedSongIds.size)return;
    if(!await iosConfirm('削除しますか？',`${selectedSongIds.size}件の曲を削除します。この操作は取り消せません。`,'削除',true))return;
    songLibrary=songLibrary.filter(s=>!selectedSongIds.has(s.id));
    playlists.forEach(p=>p.songs=p.songs.filter(id=>!selectedSongIds.has(id)));
    saveLibrary();savePlaylists();exitSelectionMode();updateSongCount();M_toast('削除しました');
}
function createNewSong(){
    const id='song_'+Date.now();
    songLibrary.push({id,title:'新規ソング',artist:'',key:'C',mode:'text',capo:0,content:'{title: 新規ソング}\n{key: C}\n\n[C] '});
    saveLibrary();updateSongCount();
    openSongDetail(id,true);
    setTimeout(()=>enterEditMode(),80);
}

/* ============ 曲詳細 ============ */
function openSongDetail(id,push=true){
    const s=getSong(id);if(!s)return;
    if(push)history.pushState({mode:'song',songId:id},'','#song='+encodeURIComponent(id));
    currentSongId=id;
    zoomLevel=100;$('zoom-slider').value=100;updateZoomFromSlider();closeZoomPanel();closeScrollPanel();
    updateDetailView(s);
    showPage('detail');
    $('detail-scroll').scrollTop=0;
}
function _closeSongDetailView(){
    currentSongId=null;
    closeChordPopup();closeScrollPanel();closeZoomPanel();
    if(activePage==='detail'||$('page-edit').classList.contains('active')){showPage('library')}
    document.body.classList.remove('hide-nav');
    renderSongList($('song-search').value);
}
function updateDetailView(s){
    $('detail-title').textContent=s.title;
    $('detail-artist').textContent=s.artist||'アーティスト未設定';
    $('key-chip-text').textContent='Key: '+convertNoteNotation(s.key)+' / '+getRelativeMinor(s.key);
    $('capo-chip-text').textContent='Capo: '+(s.capo||0);
    const mode=s.mode==='diagram'?'text':(s.mode||'text');
    $('mode-chip-text').textContent=mode==='power'?'Power Chord':mode==='nns'?'NNS':'コード名';
    updateModeUI(mode);updateKeyUI(s.key||'C');updateCapoUI(s.capo||0);
    renderScore(s);
}

/* ============ 編集 ============ */
function enterEditMode(){if(!currentSongId)return;history.pushState({mode:'edit',songId:currentSongId},'','#edit');enterEditModeInternal()}
function enterEditModeInternal(){
    const s=getSong(currentSongId);if(!s)return;
    closeZoomPanel();closeScrollPanel();closeChordPopup();
    $('edit-source').value=s.content||'';
    showPage('edit');
    document.body.classList.add('hide-nav');
}
function saveCurrentSong(){
    const s=getSong(currentSongId);if(!s)return;
    const raw=$('edit-source').value;
    s.content=raw;
    s.title=(raw.match(/\{(?:title|t):\s*(.*?)\}/i)?.[1]||s.title||'No Title').trim();
    s.artist=(raw.match(/\{(?:artist|a|subtitle|st):\s*(.*?)\}/i)?.[1]||s.artist||'').trim();
    let key=(raw.match(/\{(?:key|k):\s*(.*?)\}/i)?.[1]||s.key||'C').trim();
    if(key.endsWith('m')){const root=key.slice(0,-1);let idx=noteIndex(root);if(idx>=0)key=NOTES[(idx+3)%12]}
    s.key=key;
    saveLibrary();M_toast('保存しました');history.back();
}
async function handleEditBack(){
    if(!await iosConfirm('編集を破棄して戻りますか？','保存していない変更は失われます。','破棄',true))return;
    history.back();
}

/* ============ 音楽理論 ============ */
function noteIndex(n){let i=NOTES.indexOf(n);if(i<0)i=NOTES_FLAT.indexOf(n);if(i<0&&NOTE_ALIASES[n]!=null)i=NOTE_ALIASES[n];return i}
function getNoteLabel(i){i=((i%12)+12)%12;return notationMode==='sharp'?NOTES[i]:NOTES_FLAT[i]}
function convertNoteNotation(n){let i=noteIndex(n);return i>=0?getNoteLabel(i):n}
function transposeNote(note,semitones){let i=noteIndex(note);return i<0?note:getNoteLabel(i+semitones)}
/* 全角・Unicodeの臨時記号や小文字ルートを、解析前に一つの形式へ揃える。 */
function normalizeChordText(value){
    let text=String(value??'').trim();
    if(text.normalize)text=text.normalize('NFKC');
    return text.replace(/[♯＃]/g,'#').replace(/[♭]/g,'b').replace(/[−–—]/g,'-');
}
function parseChordParts(c){
    const text=normalizeChordText(c);
    const m=text.match(/^([A-Ga-g])([#b]?)(.*)$/);
    if(!m)return {root:text,suffix:''};
    // Cblk の b はフラット記号ではなく、品質名 blk の先頭。
    if(m[2]==='b'&&/^lk/i.test(m[3]))return {root:m[1].toUpperCase(),suffix:'b'+m[3]};
    return {root:m[1].toUpperCase()+m[2],suffix:m[3]};
}
/* 末尾が音名の /G# または onG# だけをベース音として扱う。
   C6/9 の /9 をオンコードと誤認しないための共通パーサー。 */
function parseChordSymbol(value){
    const p=parseChordParts(value);
    if(noteIndex(p.root)<0)return null;
    let suffix=p.suffix,bass='',bassSeparator='/';
    const bm=suffix.match(/(\/|on)([A-Ga-g](?:#|b)?)$/i);
    if(bm){
        bass=bm[2].charAt(0).toUpperCase()+bm[2].slice(1);
        bassSeparator=bm[1];
        suffix=suffix.slice(0,-bm[0].length);
    }
    return {root:p.root,suffix,bass,bassSeparator};
}
function getRelativeMinor(note){let i=noteIndex(note);return i<0?'?m':getNoteLabel(i+9)+'m'}
/* コード名全体 (オンコードのベース音も含む) を移調する。
   例: transposeChordName('Cm7/F',-2) → 'Bbm7/Eb' 相当 */
function transposeChordName(name,semi){
    const p=parseChordSymbol(name);
    if(!p)return normalizeChordText(name);
    const bass=p.bass?p.bassSeparator+transposeNote(p.bass,semi):'';
    return transposeNote(p.root,semi)+p.suffix+bass;
}
/* 「(Bbadd9)」「C7↓」のような括弧書き・矢印付き表記を分解する (ChordWiki 互換) */
function splitChordDecoration(tok){
    let core=String(tok),pre='',post='';
    const ar=core.match(/[\s↓↑→←]+$/);
    if(ar){post=ar[0];core=core.slice(0,core.length-ar[0].length)}
    if(core.length>1&&core.startsWith('(')){
        if(core.endsWith(')')){pre='(';post=')'+post;core=core.slice(1,-1)}
        else if(!core.slice(1).includes(')')){pre='(';core=core.slice(1)}          // 「(C」のような開き括弧のみ
        else core=core.replace(/[()]/g,'');                                        // 「(C#m7)/B」→ 括弧を外して解析
    }else if(core.length>1&&core.endsWith(')')&&!core.includes('(')){post=')'+post;core=core.slice(0,-1)} // 「Db)」
    return {pre,core,post};
}

/* ============ コード譜レンダリング ============ */
function renderScore(s){
    closeChordPopup();
    const out=$('score-output');
    const capo=s.capo||0;
    const artist=escapeHTML(s.artist||'');
    let html=artist?`<div class="score-artist-line">${artist}</div>`:'';
    String(s.content||'').split('\n').forEach(line=>{
        const tr=line.trim();
        if(tr.startsWith('{')&&tr.endsWith('}')){
            const inner=tr.slice(1,-1);
            if(/^(c|comment):/i.test(inner)) html+=`<div class="meta-block"><span class="meta-comment">${escapeHTML(inner.replace(/^(c|comment):\s*/i,''))}</span></div>`;
            else if(/^(ci|comment_italic):/i.test(inner)) html+=`<div class="meta-block"><span class="meta-comment meta-comment-italic">${escapeHTML(inner.replace(/^(ci|comment_italic):\s*/i,''))}</span></div>`;
            else if(!/^(title|t|artist|a|key|k|x-read|nicovideo|asin|youtube)/i.test(inner)) html+=`<div class="meta-block">${escapeHTML(inner.replace(/^(subtitle:|st:)\s*/i,''))}</div>`;
            return;
        }
        if(tr.startsWith('<検索用>')) return;
        if(tr===''){html+='<div style="height:14px"></div>';return;}
        if(!line.includes('[')){html+=`<div class="score-line-normal">${escapeHTML(line)}</div>`;return;}
        const mode=(s.mode==='diagram')?'text':(s.mode||'text');
        // NNS は設定値にかかわらず、図と図用の空白を一切作らない。
        const diag=diagramOn&&mode!=='nns';
        let row='<div class="score-row">';
        let remaining=line;
        const first=remaining.indexOf('[');
        if(first>0){
            row+= diag ? createSegment(null,remaining.slice(0,first)) : `<div class="chord-segment"><div class="segment-text">${escapeHTML(remaining.slice(0,first))}</div></div>`;
            remaining=remaining.slice(first);
        }
        const re=/\[(.*?)\]([^\[]*)/g;let m;
        while((m=re.exec(remaining))){
            const token=m[1],text=m[2];
            const d=splitChordDecoration(token);
            const p=parseChordParts(d.core);
            // コードとして読めないもの (小節線・記号・N.C. など) はグレー表示
            if(isNonChord(token)||noteIndex(p.root)<0){
                if(diag) row+=`<div class="chord-segment"><div class="segment-chord seg-nc-diag">${escapeHTML(token)}</div><div class="segment-text">${escapeHTML(text)}</div></div>`;
                else row+=`<div class="chord-segment"><span class="chord-name nc">${escapeHTML(token)}</span><div class="segment-text">${escapeHTML(text)}</div></div>`;
                continue;
            }
            // カポ使用時は実際に押さえるフォーム (カポ分下げたコード) を表示する — U-FRET と同方式
            const played=transposeChordName(d.core,-capo);
            if(mode==='nns'){
                const degree=getDegreeHTML(played,transposeNote(s.key||'C',-capo));
                row+=createNnsSegment(escapeHTML(d.pre)+degree+escapeHTML(d.post),text);
            }else{
                const shown=(mode==='power')?parseChordParts(played).root+'5':d.pre+played+d.post;
                if(diag) row+=createSegment(generateChordSvg(played,shown,mode),text);
                else row+=`<div class="chord-segment"><span class="chord-name" data-chord="${escapeHTML(played)}" data-shown="${escapeHTML(shown)}">${escapeHTML(shown)}</span><div class="segment-text">${escapeHTML(text)}</div></div>`;
            }
        }
        row+='</div>';html+=row;
    });
    out.innerHTML=html;
}
function isNonChord(str){return /^[|\-<>○\s←→↑↓]+$/.test(str)||['N.C.','NC'].includes(str)||/[゠-ヿ｠-ﾟ]/.test(str)}
function createSegment(svg,text){return svg?`<div class="chord-segment"><div class="segment-chord">${svg}</div><div class="segment-text">${escapeHTML(text)}</div></div>`:`<div class="chord-segment"><div class="segment-chord" style="height:56px;width:0"></div><div class="segment-text">${escapeHTML(text)}</div></div>`}
function createNnsSegment(nns,text){return `<div class="chord-segment"><div class="nns-text-container">${nns}</div><div class="segment-text">${escapeHTML(text)}</div></div>`}
/* NNSで使う品質記号を統一する。未知の記号は捨てず、そのまま残す。 */
function normalizeNnsQuality(value){
    let q=normalizeChordText(value).replace(/\s+/g,'');
    if(!q)return '';
    q=q.replace(/^minor/i,'min').replace(/^major/i,'maj').replace(/^min(?=$|M|maj|△|\d|add|sus)/i,'m');
    q=q.replace(/^m(?:M|maj|△)7/i,'-△7');
    q=q.replace(/^M7/,'△7').replace(/^maj7/i,'△7').replace(/^maj(?=$)/i,'');
    if(/^m(?=$|\d|add|sus|omit|blk)/.test(q))q='-'+q.slice(1);
    if(/^(?:6\/?9|69|\(6\/?9\))$/.test(q))q='(69)';
    q=q.replace(/^aug/i,'(5#)').replace(/^dim/i,'dim');
    q=q.replace(/\(([#b])(\d+)\)/g,(_,acc,n)=>acc==='#'?`(${n}#)`:`(-${n})`);
    q=q.replace(/([#b])(\d+)/g,(_,acc,n)=>acc==='#'?`(${n}#)`:`(-${n})`);
    q=q.replace(/\((\d+)b\)/g,'(-$1)').replace(/(\d+)b/g,'(-$1)');
    return q;
}
function buildNnsHTML(root,quality,bass=''){
    let html=`<span class="cn-root">${escapeHTML(root)}</span>`;
    if(quality)html+=`<sup class="cn-qual">${escapeHTML(quality)}</sup>`;
    if(bass)html+=`<span class="cn-slash">/</span><span class="cn-bass">${escapeHTML(bass)}</span>`;
    return html;
}
function getDegreeHTML(raw,key){
    const chord=parseChordSymbol(raw);
    if(!chord)return escapeHTML(raw);
    const keyIdx=noteIndex(key),rootIdx=noteIndex(chord.root);
    if(keyIdx<0||rootIdx<0)return escapeHTML(raw);
    const rootDeg=getDegreeLabel(rootIdx,keyIdx);
    const bi=chord.bass?noteIndex(chord.bass):-1;
    return buildNnsHTML(rootDeg,normalizeNnsQuality(chord.suffix),bi>=0?getDegreeLabel(bi,keyIdx):'');
}
function getDegreeLabel(note,key){const labels=notationMode==='flat'?MajorDegrees.flat:MajorDegrees.sharp;return labels[(note-key+12)%12]}

/* ============ コードダイアグラム SVG ============ */
const chordSvgCache=new Map();
const CHORD_SVG_CACHE_LIMIT=512;
function normalizeChordShape(shape){
    if(!Array.isArray(shape)||shape.length!==6)return null;
    const normalized=shape.map(f=>f==null?-1:Number(f));
    if(normalized.some(f=>!Number.isInteger(f)||f< -1||f>36))return null;
    return normalized.some(f=>f>=0)?normalized:null;
}
function cacheChordSvg(key,svg){
    if(chordSvgCache.size>=CHORD_SVG_CACHE_LIMIT)chordSvgCache.delete(chordSvgCache.keys().next().value);
    chordSvgCache.set(key,svg);
    return svg;
}
function chordDiagramLabel(display){
    return normalizeChordText(display).replace(/([A-G])b/g,'$1♭').replace(/b(?=\d)/g,'♭');
}
function generateChordSvg(raw,display,mode){
    // NNSからは、呼び出し側に不具合があっても絶対に図を返さない。
    if(mode==='nns')return '';
    const t=TUNINGS[tuningId]||TUNINGS.std;
    const cacheKey=[normalizeChordText(raw),normalizeChordText(display),mode,tuningId,powerLowOnly?'low':'auto'].join('|');
    if(chordSvgCache.has(cacheKey))return chordSvgCache.get(cacheKey);
    let shape=null;
    if(mode==='power'){
        const r=parseChordParts(raw).root,idx=noteIndex(r);
        if(idx>=0)shape=getPowerChordShape(NOTES[(idx+t.shift)%12],t.drop);
    }
    shape=normalizeChordShape(shape);
    if(!shape&&mode!=='power'){
        const raw2=t.shift?transposeChordName(raw,t.shift):normalizeChordText(raw);
        shape=getChordShape(raw2);
        if(shape&&t.drop)shape=applyDropD(shape,raw2);
        shape=normalizeChordShape(shape);
        // 未知の複合サフィックスでも、ルートの基本形まで必ずフォールバックする。
        if(!shape){
            const symbol=parseChordSymbol(raw2),idx=symbol?noteIndex(symbol.root):-1;
            if(idx>=0){
                shape=barreShape(idx,'')||getPowerChordShape(NOTES[idx],t.drop);
                if(shape&&t.drop&&symbol)shape=applyDropD(shape,raw2);
                shape=normalizeChordShape(shape);
            }
        }
    }
    // 有効なコードなら上で必ず到達する。最後の安全網も「全ミュート」にはしない。
    if(!shape)shape=[-1,3,2,0,1,0];
    const w=64,h=56,mt=16,mr=10,mb=8,ml=10,gw=w-ml-mr,gh=h-mt-mb,strings=6,frets=4,sg=gh/(strings-1),fg=gw/frets;
    const vals=shape.filter(f=>f>0),min=vals.length?Math.min(...vals):0,max=vals.length?Math.max(...vals):0,base=max>4?min:1;
    const INK=diagInk();
    const label=chordDiagramLabel(display),fs=label.length>9?8:label.length>7?9:label.length>4?10:label.length>2?11:12;
    let svg=`<text x="${w/2}" y="${mt/2+2}" font-family="Arial, sans-serif" font-weight="900" font-size="${fs}px" text-anchor="middle" dominant-baseline="central" fill="${INK}">${escapeHTML(label)}</text>`;
    for(let i=0;i<strings;i++){const y=Math.round(mt+i*sg);svg+=`<line x1="${ml}" y1="${y}" x2="${ml+gw}" y2="${y}" stroke="${INK}" stroke-width="1"/>`}
    for(let i=0;i<=frets;i++){const x=Math.round(ml+i*fg);svg+=`<line x1="${x}" y1="${mt}" x2="${x}" y2="${mt+gh}" stroke="${INK}" stroke-width="${i===0&&base===1?2:1}"/>`}
    if(base>1)svg+=`<text x="${ml}" y="${h-4}" font-family="serif" font-weight="bold" font-size="11" text-anchor="middle" dominant-baseline="central" fill="${INK}">${base}</text>`;
    shape.forEach((f,idx)=>{
        const cy=mt+(strings-1-idx)*sg;
        if(f>0){
            const fp=f-base+1;
            if(fp>=1&&fp<=4){const cx=ml+(fp-.5)*fg;svg+=`<circle class="fretted-note" cx="${cx}" cy="${cy}" r="2.6" fill="${INK}"/>`}
        }else if(f===0){
            // Drop D の D5 (0-0-0) のような全開放フォームも空に見えないよう、
            // 太い開放リングと中心点をセットで描く。
            svg+=`<circle class="open-note" cx="${ml/2}" cy="${cy}" r="2.7" stroke="${INK}" stroke-width="1.25" fill="#fff"/><circle cx="${ml/2}" cy="${cy}" r="0.75" fill="${INK}"/>`;
        }
        else svg+=`<line x1="${ml/2-2}" y1="${cy-2}" x2="${ml/2+2}" y2="${cy+2}" stroke="${INK}"/><line x1="${ml/2+2}" y1="${cy-2}" x2="${ml/2-2}" y2="${cy+2}" stroke="${INK}"/>`;
    });
    const aria=escapeHTML(`${label} コードダイアグラム`);
    return cacheChordSvg(cacheKey,`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="56" viewBox="0 0 64 56" preserveAspectRatio="xMidYMid meet" class="chord-diagram" role="img" aria-label="${aria}" focusable="false">${svg}</svg>`);
}
/* コード名から押さえ方を求める。
   1. CHORD_SHAPES の完全一致
   2. オンコードのベース音・テンション括弧を外した基本形
   3. サフィックスを段階的に簡略化しながら CHORD_SHAPES → バレー基本形の順で探す */
function getChordShape(chord){
    const normalized=normalizeChordText(chord);
    if(CHORD_SHAPES[normalized])return CHORD_SHAPES[normalized];
    const symbol=parseChordSymbol(normalized);
    if(!symbol)return null;
    const ri=noteIndex(symbol.root);
    if(ri<0)return null;
    const sfx=symbol.suffix
        .replace(/\((?:maj7|M7)\)/i,'M7')                    // m(maj7) → mM7
        .replace(/\((?:b5|-5)\)/,'-5')                       // m7(b5) → m7-5
        .replace(/\([^)]*\)/g,'');                           // その他テンション括弧は除去
    for(const cand of suffixCandidates(sfx)){
        const hit=CHORD_SHAPES[symbol.root+cand]
            ||(ENHARMONIC[symbol.root]?CHORD_SHAPES[ENHARMONIC[symbol.root]+cand]:null)
            ||barreShape(ri,cand);
        if(hit)return hit;
    }
    return CHORD_SHAPES[symbol.root]
        ||(ENHARMONIC[symbol.root]?CHORD_SHAPES[ENHARMONIC[symbol.root]]:null)
        ||barreShape(ri,'')||null;
}
/* 未知のサフィックスを近い基本形へ段階的に簡略化した候補リストを返す */
function suffixCandidates(sfx){
    const out=[],push=v=>{if(v!=null&&!out.includes(v))out.push(v)};
    const s=String(sfx).replace(/^-(?=△|M|maj|\d|add|sus)/,'m').replace(/maj/gi,'M').replace(/△/g,'M');
    push(sfx);push(s);
    if(/^mM7/.test(s)){push('mM7');push('m')}
    else if(/^m/.test(s)){ // 小文字 m = マイナー系 (maj は既に M へ正規化済み)
        if(/^m7?[-b]5/.test(s))push('m7-5');
        if(/^m6/.test(s))push('m6');
        if(/^m(7|9|11|13)/.test(s))push('m7');
        push('m');
    }
    else if(/^(dim|°)/.test(s))push('dim7');
    else if(/^(aug|\+)/.test(s))push('aug');
    else if(/^M(7|9|13)/.test(s))push('M7');
    else if(/^7sus/.test(s)){push('7sus4');push('sus4')}
    else if(/^(7|9|11|13)/.test(s)){if(/^9/.test(s))push('9');push('7')}
    else if(/^sus4/.test(s))push('sus4');
    else if(/^sus2/.test(s))push('sus2');
    else if(/^add/.test(s))push('add9');
    else if(/^6/.test(s))push('6');
    else if(/^5$/.test(s))push('5');
    push('');
    return out;
}
/* バレー基本形 (BARRE_FORMS) をルートへ平行移動して押さえ方を生成する */
function barreShape(rootIdx,sfx){
    const forms=BARRE_FORMS[sfx];if(!forms)return null;
    const rootFret={E:(rootIdx-4+12)%12,A:(rootIdx-9+12)%12,D:(rootIdx-2+12)%12};
    let best=null,bestF=Infinity;
    for(const k of Object.keys(forms)){
        const f=rootFret[k];
        let invalid=false;
        const shape=forms[k].map(o=>{if(o===null)return -1;const v=o+f;if(v<0)invalid=true;return v});
        if(invalid)continue;                                // 開放弦より下は押さえられない
        const vals=shape.filter(v=>v>0);
        const mn=vals.length?Math.min(...vals):0,mx=vals.length?Math.max(...vals):0;
        if(mx>4&&mx-mn+1>4)continue;                        // 4フレット枠に収まらない形は不可
        if(f<bestF){bestF=f;best=shape}
    }
    return best;
}
function getPowerChordShape(root,dropd){
    let idx=noteIndex(root);if(idx<0)return null;
    if(dropd){
        const f6=(idx-2+12)%12,f5=(idx-9+12)%12;
        if(powerLowOnly||f6<=4||f6<f5)return[f6,f6,f6,-1,-1,-1];
        return f5===0?[-1,0,2,2,-1,-1]:[-1,f5,f5+2,f5+2,-1,-1];
    }
    const f6=(idx-4+12)%12,f5=(idx-9+12)%12;
    // 「低音3弦のみ」設定時は常に6弦ルート (6・5・4弦) のフォームを使う
    if(powerLowOnly||f6<=4||f6<f5)return f6===0?[0,2,2,-1,-1,-1]:[f6,f6+2,f6+2,-1,-1,-1];
    return f5===0?[-1,0,2,2,-1,-1]:[-1,f5,f5+2,f5+2,-1,-1];
}
function applyDropD(shape,raw){
    const sh=shape.slice();
    if(sh[0]>=0){sh[0]+=2}else{const r=parseChordParts(raw||'').root;if(r&&noteIndex(r)===2)sh[0]=0}
    const vals=sh.filter(f=>f>0);
    if(vals.length&&shape[0]>=0){const mx=Math.max(...vals),mn=Math.min(...vals);if((mx>4&&mx-mn>3)||(mx>4&&sh.includes(0)))sh[0]=-1}
    return sh;
}

/* ============ コードポップアップ ============ */
let popupChord=null;
function showChordPopup(chord,shown){
    const p=$('chord-popup');
    if(popupChord===chord&&p.classList.contains('show')){closeChordPopup();return}
    let mode=getSong(currentSongId)?.mode||'text';if(mode==='diagram')mode='text';
    if(mode==='nns'){closeChordPopup();return}
    const svg=generateChordSvg(chord,shown,mode);
    if(!svg){closeChordPopup();return}
    popupChord=chord;
    $('chord-popup-body').innerHTML=svg;
    p.classList.add('show');
    document.querySelectorAll('.chord-name').forEach(e=>e.classList.toggle('playing',e.dataset.chord===chord));
}
function closeChordPopup(){const p=$('chord-popup');if(p)p.classList.remove('show');popupChord=null;document.querySelectorAll('.chord-name.playing').forEach(e=>e.classList.remove('playing'))}

/* ============ ズーム ============ */
function toggleZoomPanel(){const p=$('zoom-panel');const on=!p.classList.contains('show');p.classList.toggle('show',on);$('zoom-btn').classList.toggle('on',on);if(on)closeScrollPanel()}
function closeZoomPanel(){$('zoom-panel').classList.remove('show');$('zoom-btn').classList.remove('on')}
function updateZoomFromSlider(){
    zoomLevel=parseInt($('zoom-slider').value);
    $('zoom-val-text').textContent=zoomLevel+'%';
    const pct=((zoomLevel-50)/250*100);
    $('zoom-slider').style.setProperty('--p',pct+'%');
    applyZoom(zoomLevel/100);
}
function applyZoom(scale){const c=$('zoom-container');c.style.transform=`scale(${scale})`;c.style.width=`${100/scale}%`}

/* ============ オートスクロール ============ */
function toggleScrollPanel(){const p=$('scroll-panel');const on=!p.classList.contains('show');p.classList.toggle('show',on);$('scroll-btn').classList.toggle('on',on);if(!on)stopAutoScroll();else closeZoomPanel()}
function closeScrollPanel(){$('scroll-panel').classList.remove('show');$('scroll-btn').classList.remove('on');stopAutoScroll()}
function toggleAutoScroll(){isScrolling?stopAutoScroll():startAutoScroll()}
function startAutoScroll(){
    isScrolling=true;
    const b=$('scroll-play-btn');
    b.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    b.classList.add('stop');
    let last=0,acc=0;
    const step=t=>{
        if(!isScrolling)return;
        if(last){
            const speed=parseInt($('scroll-speed').value)*2;
            acc+=speed*(t-last)/1000;
            if(acc>=1){const px=Math.floor(acc);$('detail-scroll').scrollTop+=px;acc-=px}
        }
        last=t;requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}
function stopAutoScroll(){
    isScrolling=false;
    const b=$('scroll-play-btn');
    b.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    b.classList.remove('stop');
}

/* ============ 表示設定 ============ */
function setNotation(mode){notationMode=mode;localStorage.setItem('cv_notation',mode);updateSettingsUI();if(currentSongId)updateDetailView(getSong(currentSongId))}
function updateSettingsUI(){
    $('notation-sharp-row').classList.toggle('selected',notationMode==='sharp');
    $('notation-flat-row').classList.toggle('selected',notationMode==='flat');
    $('accent-value').textContent=ACCENTS[accentId].label;
    $('theme-value').textContent=THEMES[themeId].label;
    $('diagram-row').classList.toggle('selected',diagramOn);
    $('power-low-row').classList.toggle('selected',powerLowOnly);
}
function updateModeUI(mode){document.querySelectorAll('#settings-sheet .settings-row[data-mode]').forEach(e=>e.classList.toggle('selected',e.dataset.mode===mode))}
function openSettingsSheet(){if(!currentSongId){M_toast('曲を選択してください');return}$('settings-sheet').classList.add('show')}
function closeSettingsSheet(){$('settings-sheet').classList.remove('show')}
function toggleDiag(){diagramOn=!diagramOn;localStorage.setItem('cv_diagram',diagramOn?'on':'off');updateSettingsUI();if(currentSongId){const s=getSong(currentSongId);if(s)renderScore(s)}}
function togglePowerLow(){powerLowOnly=!powerLowOnly;localStorage.setItem('cv_power_low',powerLowOnly?'on':'off');updateSettingsUI();if(currentSongId){const s=getSong(currentSongId);if(s)renderScore(s)}}
function setMode(m){const s=getSong(currentSongId);if(!s)return;s.mode=m;saveLibrary();updateDetailView(s)}
function setTuning(id){if(!TUNINGS[id])id='std';tuningId=id;localStorage.setItem('cv_tuning',id);updateTuningUI();if(currentSongId){const sg=getSong(currentSongId);if(sg)renderScore(sg)}}
function renderTuningList(){
    const c=$('tuning-list');c.innerHTML='';
    Object.entries(TUNINGS).forEach(([id,t])=>{
        const row=document.createElement('div');
        row.className='settings-row'+(id===tuningId?' selected':'');
        row.dataset.tuning=id;
        row.innerHTML=`<div class="settings-icon"><svg viewBox="0 0 24 24" class="svg-icon" style="width:20px;height:20px;"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg></div><div class="settings-label">${escapeHTML(t.label)}<div class="settings-sub">${escapeHTML(t.desc)}</div></div><div class="settings-check">${SVG_CHECK}</div>`;
        row.onclick=()=>setTuning(id);
        c.appendChild(row);
    });
}
function updateTuningUI(){document.querySelectorAll('#tuning-list .settings-row').forEach(e=>e.classList.toggle('selected',e.dataset.tuning===tuningId))}
/* アプリ内テーマに合わせて Android のステータスバー/ナビゲーションバーの配色も切り替える。
   さきいかビルダーは theme:"auto" のとき setDark で保存した配色を次回起動時にも復元する。 */
function syncSystemBars(){
    if(window.Android&&Android.available&&Android.ui){
        try{Android.ui.setDark({dark:themeId!=='light'}).catch(()=>{})}catch(_){}
    }
}
function applyTheme(){
    document.documentElement.setAttribute('data-theme',themeId);
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',themeId==='light'?'#f9f9fb':'#000000');
    syncSystemBars();
    updateSettingsUI();
    // ダイアグラムの描画色を反映
    if(currentSongId){const s=getSong(currentSongId);if(s)renderScore(s)}
    if(popupChord)closeChordPopup();
}
async function pickTheme(){
    const keys=Object.keys(THEMES);
    const i=await actionSheet('テーマ',keys.map(k=>({label:THEMES[k].label,active:k===themeId})));
    if(i<0)return;
    themeId=keys[i];localStorage.setItem('cv_theme',themeId);applyTheme();
}
function applyAccent(){document.documentElement.style.setProperty('--primary-color',ACCENTS[accentId].c);updateSettingsUI()}
async function pickAccent(){
    const keys=Object.keys(ACCENTS);
    const i=await actionSheet('アクセントカラー',keys.map(k=>({label:ACCENTS[k].label,active:k===accentId})));
    if(i<0)return;
    accentId=keys[i];localStorage.setItem('cv_accent',accentId);applyAccent();
}

/* ---- Key / Capo ---- */
function keyLabel(i){const root=notationMode==='sharp'?NOTES[i]:NOTES_FLAT[i];return `${root} / ${getRelativeMinor(root)}`}
async function pickKey(){
    const s=getSong(currentSongId);if(!s)return;
    const cur=noteIndex(s.key||'C');
    const opts=[];for(let i=0;i<12;i++)opts.push({label:keyLabel(i),active:i===cur});
    const i=await actionSheet('Key',opts);if(i<0)return;
    s.key=NOTES[i];saveLibrary();updateDetailView(s);
}
async function pickCapo(){
    const s=getSong(currentSongId);if(!s)return;
    const cur=s.capo||0;
    const opts=[];for(let i=0;i<12;i++)opts.push({label:i===0?'0 (なし)':String(i),active:i===cur});
    const i=await actionSheet('Capo',opts);if(i<0)return;
    s.capo=i;saveLibrary();updateDetailView(s);
}
function updateKeyUI(key){const i=noteIndex(key);$('key-value').textContent=i>=0?keyLabel(i):String(key)}
function updateCapoUI(capo){$('capo-value').textContent=capo===0?'0 (なし)':String(capo)}

/* ============ データ管理 (バックアップ) ============ */
function hasBridge(){return !!(window.Android&&Android.available)}

/* JSONファイルとして書き出す。
   さきいかランタイムの実仕様 (ChoBoard で動作確認済みの API のみ使用):
   - fs.createFile({name, mime, data, encoding}) … SAF の保存ダイアログ。data を渡すと作成と同時に書き込み。
     キャンセル時は例外ではなく {ok:false, reason:"cancelled"} が返る。成功時は {ok:true, item:{uri,...}}
   - SAF uri への書き込みは fs.writeUri({uri, data, encoding}) (fs.write は path 専用)
   - 共有は fs.shareFile({path})、クリップボードは clipboard.write({text, label}) */
async function exportData(){
    const d=new Date(),z=n=>String(n).padStart(2,'0');
    const payload={app:'acrosschord',version:2,exportedAt:d.toISOString(),songs:songLibrary,playlists};
    const json=JSON.stringify(payload,null,2);
    const fname=`acrosschord-backup-${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}.json`;
    if(!(hasBridge()&&Android.fs)){
        // ブラウザ / PWA (iOS 含む): Blob ダウンロード
        try{
            const blob=new Blob([json],{type:'application/json'});
            const a=document.createElement('a');
            a.href=URL.createObjectURL(blob);a.download=fname;
            document.body.appendChild(a);a.click();a.remove();
            setTimeout(()=>URL.revokeObjectURL(a.href),3000);
            M_toast('バックアップを書き出しました');
        }catch(e){console.warn('blobダウンロード失敗',e);showBackupText(json)}
        return;
    }
    // 1) SAF「名前を付けて保存」— data 同時書き込み + 読み戻し検証
    try{
        const res=await Android.fs.createFile({name:fname,mime:'application/json',data:json,encoding:'utf8'});
        if(res&&res.ok===false){M_toast('保存をキャンセルしました');return}
        const item=(res&&res.item)||res||{};
        const uri=item.uri;
        let verified=Number(item.size)>0;
        if(!verified&&uri){
            try{verified=String(await Android.fs.readUri({uri,encoding:'utf8'})||'').length>0}catch(_){}
            if(!verified){
                try{
                    await Android.fs.writeUri({uri,data:json,encoding:'utf8'});
                    verified=String(await Android.fs.readUri({uri,encoding:'utf8'}).catch(()=>'')||'').length>0;
                }catch(_){}
            }
        }
        if(verified){M_toast('バックアップを保存しました');return}
        console.warn('SAF保存を検証できず共有へフォールバック');
    }catch(e){console.warn('createFile失敗',e)}
    // 2) アプリ領域に書いて共有シートで任意の場所へ
    try{
        await Android.fs.write({path:fname,data:json,encoding:'utf8'});
        const st=await Android.fs.stat({path:fname}).catch(()=>null);
        if(!st||Number(st.size??1)>0){await Android.fs.shareFile({path:fname});return}
    }catch(e){console.warn('shareFile失敗',e)}
    // 3) クリップボード
    try{await Android.clipboard.write({text:json,label:'acrosschord-backup'});M_toast('ファイル保存に対応していないため、クリップボードにコピーしました');return}catch(_){}
    try{await Android.clipboard.set({text:json});M_toast('クリップボードにコピーしました');return}catch(_){}
    // 4) 最終手段: 画面に表示して手動コピー (必ず成功する)
    showBackupText(json);
}
function showBackupText(json){
    $('backup-text').value=json;
    $('backup-text-modal').classList.add('show');
    M_toast('自動保存できないため文字列を表示しました。コピーして保存してください');
}
async function copyBackupText(){
    const ta=$('backup-text');ta.focus();ta.select();
    try{await navigator.clipboard.writeText(ta.value);M_toast('コピーしました');return}catch(_){}
    try{document.execCommand('copy');M_toast('コピーしました')}catch(_){M_toast('テキストを長押しでコピーしてください')}
}

/* ---- インポート (ファイル選択 or 貼り付け) ---- */
function openImportSheet(){
    $('import-text').value='';
    $('import-file').value='';
    $('import-file-name').textContent='';
    $('import-modal').classList.add('show');
}
function closeImportSheet(){$('import-modal').classList.remove('show')}
function readFileText(f){
    return new Promise((res,rej)=>{
        const r=new FileReader();
        r.onload=()=>res(String(r.result));
        r.onerror=rej;
        r.readAsText(f,'utf-8');
    });
}
async function runImport(){
    let text=$('import-text').value;
    const f=$('import-file').files?.[0];
    if(!text.trim()&&f){
        try{text=await readFileText(f)}catch(e){console.error(e);M_toast('ファイルを読み込めませんでした');return}
    }
    if(!text.trim()){M_toast('ファイルを選択するか、バックアップ文字列を貼り付けてください');return}
    await restoreBackup(text);
}
/* 新形式 {app,songs,playlists} / 旧形式 (曲配列・単曲) の両方を受け付ける */
async function restoreBackup(text){
    let data;
    try{data=JSON.parse(text)}catch(e){M_toast('バックアップの形式が正しくありません');return}
    let songs=[],lists=[];
    if(Array.isArray(data))songs=data;
    else if(data&&typeof data==='object'){
        if(Array.isArray(data.songs))songs=data.songs;
        if(Array.isArray(data.playlists))lists=data.playlists;
        if(!songs.length&&!lists.length&&data.content)songs=[data];
    }
    songs=songs.filter(s=>s&&typeof s==='object');
    lists=lists.filter(p=>p&&typeof p==='object'&&p.id);
    if(!songs.length&&!lists.length){M_toast('読み込めるデータがありません');return}
    const msg=`曲 ${songs.length} 件`+(lists.length?`・プレイリスト ${lists.length} 件`:'')+' を追加/更新します。';
    if(!await iosConfirm('読み込みますか？',msg,'追加'))return;
    songs.forEach(ns=>{
        if(!ns.id)ns.id='song_'+Date.now()+'_'+Math.random().toString(36).slice(2);
        if(!ns.title)ns.title='No Title';
        if(!ns.content)ns.content='{title: No Title}\n{key: C}\n\n[C] ';
        const i=songLibrary.findIndex(ex=>ex.id===ns.id);
        i>=0?songLibrary[i]=ns:songLibrary.push(ns);
    });
    lists.forEach(pl=>{
        pl.title=pl.title||'プレイリスト';
        pl.songs=Array.isArray(pl.songs)?pl.songs:[];
        const i=playlists.findIndex(ex=>ex.id===pl.id);
        i>=0?playlists[i]=pl:playlists.push(pl);
    });
    saveLibrary();savePlaylists();
    renderSongList($('song-search').value);renderPlaylistCollection();updateSongCount();
    closeImportSheet();
    M_toast('読み込み完了');
}
async function resetAllData(){
    if(!await iosConfirm('全データを削除しますか？','曲・プレイリスト・設定をすべて消去します。この操作は取り消せません。','削除',true))return;
    localStorage.removeItem('cv_library');
    localStorage.removeItem('cv_playlists');
    localStorage.removeItem('cv_notation');
    localStorage.removeItem('cv_tuning');
    localStorage.removeItem('cv_accent');
    localStorage.removeItem('cv_theme');
    location.reload();
}
function updateSongCount(){$('song-count-info').textContent=String(songLibrary.length)}

/* ============ プレイリスト ============ */
function renderPlaylistCollection(){
    const c=$('playlist-collection');c.innerHTML='';
    if(!playlists.length){
        c.innerHTML=`<div class="empty-library">
            <svg viewBox="0 0 24 24" class="svg-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <p>プレイリストがありません</p>
            <span>右上の追加ボタンからプレイリストを作成できます</span>
        </div>`;
        return;
    }
    playlists.forEach(pl=>{
        const row=document.createElement('div');
        row.className='list-row'+(selectedPlaylistIds.has(pl.id)?' selected':'');
        row.addEventListener('touchstart',()=>startPlaylistLongPress(pl.id),{passive:true});
        row.addEventListener('touchend',cancelLongPress,{passive:true});
        row.addEventListener('touchmove',cancelLongPress,{passive:true});
        row.addEventListener('mousedown',()=>startPlaylistLongPress(pl.id));
        row.addEventListener('mouseup',cancelLongPress);
        row.addEventListener('mouseleave',cancelLongPress);
        row.addEventListener('contextmenu',e=>{e.preventDefault();if(!isPlaylistSelectionMode)enterPlaylistSelectionMode(pl.id)});
        row.onclick=()=>handlePlaylistItemClick(pl.id);
        const right=isPlaylistSelectionMode
            ?(selectedPlaylistIds.has(pl.id)?`<div class="song-check">${SVG_CHECK}</div>`:'<div style="width:24px;"></div>')
            :`<div class="settings-chevron">${SVG_CHEVRON}</div>`;
        row.innerHTML=`<div class="list-cover-empty"><svg viewBox="0 0 24 24" class="svg-icon" style="width:26px;height:26px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div><div class="list-row-info"><div class="list-row-title">${escapeHTML(pl.title)}</div><div class="list-row-count">${pl.songs.length} 曲</div></div>${right}`;
        c.appendChild(row);
    });
}
function startPlaylistLongPress(id){if(isPlaylistSelectionMode)return;cancelLongPress();longPressTimer=setTimeout(()=>enterPlaylistSelectionMode(id),600)}
function enterPlaylistSelectionMode(id){suppressNextClick=true;isPlaylistSelectionMode=true;selectedPlaylistIds.clear();selectedPlaylistIds.add(id);updateSelectionUI();navigator.vibrate?.(50);setTimeout(()=>suppressNextClick=false,500)}
function exitPlaylistSelectionMode(){isPlaylistSelectionMode=false;selectedPlaylistIds.clear();updateSelectionUI()}
function handlePlaylistItemClick(id){
    if(suppressNextClick)return;
    if(isPlaylistSelectionMode){
        selectedPlaylistIds.has(id)?selectedPlaylistIds.delete(id):selectedPlaylistIds.add(id);
        if(!selectedPlaylistIds.size)exitPlaylistSelectionMode();else updateSelectionUI();
    }else openPlaylistDetail(id);
}
async function deleteSelectedPlaylists(){
    if(!selectedPlaylistIds.size)return;
    if(!await iosConfirm('削除しますか？',`${selectedPlaylistIds.size}件のプレイリストを削除します。`,'削除',true))return;
    playlists=playlists.filter(p=>!selectedPlaylistIds.has(p.id));
    savePlaylists();exitPlaylistSelectionMode();M_toast('削除しました');
}
async function createPlaylist(){
    const name=await iosPrompt('プレイリスト名');
    if(!name)return;
    playlists.push({id:'pl_'+Date.now(),title:name,songs:[]});
    savePlaylists();renderPlaylistCollection();
}
function openPlaylistDetail(id){history.pushState({mode:'playlist_detail',playlistId:id},'','#playlist/'+encodeURIComponent(id));_openPlaylistDetailInternal(id)}
function _openPlaylistDetailInternal(id){
    currentPlaylistId=id;
    const pl=playlists.find(p=>p.id===id);if(!pl)return;
    $('playlist-collection').style.display='none';
    $('playlist-song-container').style.display='block';
    $('pl-header-title').textContent=pl.title;
    $('pl-back-btn').style.display='flex';
    $('pl-add-btn').style.display='none';
    $('pl-addsong-btn').style.display='flex';
    renderPlaylistSongs(pl);
}
function _closePlaylistDetail(){
    currentPlaylistId=null;
    $('playlist-collection').style.display='flex';
    $('playlist-song-container').style.display='none';
    $('pl-header-title').textContent='プレイリスト';
    $('pl-back-btn').style.display='none';
    $('pl-add-btn').style.display='flex';
    $('pl-addsong-btn').style.display='none';
    renderPlaylistCollection();
}
function renderPlaylistSongs(pl){
    const c=$('playlist-song-container');c.innerHTML='';
    if(!pl.songs.length){
        c.innerHTML=`<div class="empty-library">
            <svg viewBox="0 0 24 24" class="svg-icon"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            <p>曲がありません</p>
            <span>右上の曲追加ボタンからライブラリの曲を追加できます</span>
        </div>`;
        return;
    }
    const card=document.createElement('div');card.className='song-group';card.style.marginTop='12px';
    pl.songs.forEach((id,idx)=>{
        const s=getSong(id);if(!s)return;
        const li=document.createElement('div');
        li.className='song-item';
        li.onclick=()=>openSongDetail(s.id,true);
        li.innerHTML=`<div class="song-icon">${escapeHTML((s.title||'?').charAt(0))}</div><div class="song-info"><div class="song-title-list">${escapeHTML(s.title)}</div><div class="song-artist-list">${escapeHTML(s.artist||'')}</div></div><button class="icon-btn pl-remove" style="color:var(--sub-text-color);" aria-label="削除"><svg viewBox="0 0 24 24" class="svg-icon" style="width:20px;height:20px;"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg></button>`;
        li.querySelector('.pl-remove').onclick=e=>{e.stopPropagation();removeSongFromPlaylist(pl.id,idx)};
        card.appendChild(li);
    });
    c.appendChild(card);
}
function removeSongFromPlaylist(plId,idx){
    const pl=playlists.find(p=>p.id===plId);if(!pl)return;
    pl.songs.splice(idx,1);savePlaylists();renderPlaylistSongs(pl);
}
function openSongPicker(){
    const pl=playlists.find(p=>p.id===currentPlaylistId);if(!pl)return;
    const list=$('picker-list');list.innerHTML='';
    const existing=new Set(pl.songs);
    [...songLibrary].sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),'ja')).forEach(s=>{
        const div=document.createElement('div');
        div.className='picker-item'+(existing.has(s.id)?' already':'');
        div.dataset.id=s.id;
        if(!existing.has(s.id))div.onclick=()=>div.classList.toggle('selected');
        div.innerHTML=`<span class="picker-check">${SVG_CHECK}</span><div><div class="picker-title">${escapeHTML(s.title)}</div><div class="picker-artist">${escapeHTML(s.artist||'')}</div></div>`;
        list.appendChild(div);
    });
    $('song-picker-modal').classList.add('show');
}
function closeSongPicker(){$('song-picker-modal').classList.remove('show')}
function addSongsToPlaylist(){
    const pl=playlists.find(p=>p.id===currentPlaylistId);if(!pl)return;
    document.querySelectorAll('#picker-list .picker-item.selected').forEach(el=>{
        if(!pl.songs.includes(el.dataset.id))pl.songs.push(el.dataset.id);
    });
    savePlaylists();closeSongPicker();renderPlaylistSongs(pl);M_toast('追加しました');
}

/* ============ チューナー ============ */
async function ensureMicPermission(){
    // Android アプリ内では OS の実行時権限を先に確保する。
    // 「今回のみ」で許可された権限はアプリ終了時に失効するため、
    // 失効していれば毎回ここでダイアログを出し直す。
    if(!(window.Android&&Android.available))return true;
    try{
        const c=await Android.perm.check({permissions:['RECORD_AUDIO']});
        if(c&&c.granted)return true;
        const r=await Android.perm.request({permissions:['RECORD_AUDIO']});
        return !!(r&&r.granted);
    }catch(e){return false}
}
async function startTunerWebAudio(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('mediaDevices unavailable');
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    analyser=audioCtx.createAnalyser();
    analyser.fftSize=4096;
    try{
        micStream=await navigator.mediaDevices.getUserMedia({audio:true});
        audioCtx.createMediaStreamSource(micStream).connect(analyser);
        updatePitch();
    }catch(e){
        try{audioCtx.close()}catch(_){}
        audioCtx=null;analyser=null;micStream=null;
        throw e;
    }
}
/* getUserMedia が使えない WebView 向け: reflect ブリッジで AudioRecord を直接駆動 */
async function startTunerBridge(){
    const R=Android.reflect,SR=44100,N=2048;
    const min=await R.staticCall({class:'android.media.AudioRecord',method:'getMinBufferSize',args:[SR,16,2]});
    const bufBytes=Math.max((typeof min==='number'&&min>0)?min:0,N*4);
    let rec=null;
    for(const src of[6,1]){ // VOICE_RECOGNITION(6) が使えなければ MIC(1)
        try{
            const cand=await R['new']({class:'android.media.AudioRecord',args:[src,SR,16,2,bufBytes]});
            if(await R.call({ref:cand.__ref,method:'getState'})===1){rec=cand;break}
            try{await R.call({ref:cand.__ref,method:'release'})}catch(_){}
            try{await R.release({ref:cand.__ref})}catch(_){}
        }catch(_){}
    }
    if(!rec)throw new Error('AudioRecord unavailable');
    const buf=await R.arrayOf({component:'short',length:N});
    await R.call({ref:rec.__ref,method:'startRecording'});
    bridgeTuner={rec:rec.__ref,buf:buf.__ref,sr:SR,n:N};
    bridgeTunerLoop();
}
async function bridgeTunerLoop(){
    const R=Android.reflect;
    while(bridgeTuner){
        const t=bridgeTuner;
        try{
            const n=await R.call({ref:t.rec,method:'read',args:[{__ref:t.buf},0,t.n]});
            if(!bridgeTuner)break;
            if(typeof n==='number'&&n>0){
                const parts=(await R.staticCall({class:'java.util.Arrays',method:'toString',args:[{__ref:t.buf}]})).slice(1,-1).split(', ');
                const f=new Float32Array(n);
                for(let i=0;i<n;i++)f[i]=parts[i]/32768;
                showPitch(autoCorrelate(f,t.sr));
            }
        }catch(e){break}
    }
}
async function stopTunerBridge(){
    if(!bridgeTuner)return;
    const t=bridgeTuner;bridgeTuner=null;
    const R=Android.reflect;
    try{await R.call({ref:t.rec,method:'stop'})}catch(_){}
    try{await R.call({ref:t.rec,method:'release'})}catch(_){}
    try{await R.release({ref:t.rec})}catch(_){}
    try{await R.release({ref:t.buf})}catch(_){}
}
async function startTuner(){
    try{
        if(!await ensureMicPermission())throw new Error('permission');
        try{
            await startTunerWebAudio();
        }catch(e){
            if(window.Android&&Android.available)await startTunerBridge();
            else throw e;
        }
    }catch(e){
        M_toast('マイク使用許可が必要です');
        const btn=$('tuner-toggle-btn');btn.textContent='開始';btn.classList.remove('on');
    }
}
function stopTuner(){
    if(audioCtx&&audioCtx.state!=='closed'){try{audioCtx.close()}catch(_){}}
    audioCtx=null;analyser=null;
    if(micStream){try{micStream.getTracks().forEach(tr=>tr.stop())}catch(_){}micStream=null}
    cancelAnimationFrame(tunerRaf);
    stopTunerBridge();
}
function toggleTuner(){
    const btn=$('tuner-toggle-btn');
    if((audioCtx&&audioCtx.state!=='closed')||bridgeTuner){
        stopTuner();
        btn.textContent='開始';btn.classList.remove('on');
    }else{
        startTuner();
        btn.textContent='停止';btn.classList.add('on');
    }
}
function showPitch(freq){
    if(freq!==-1&&isFinite(freq)&&freq>0){
        $('tuner-freq').textContent=Math.round(freq);
        const n=Math.round(12*Math.log2(freq/440)+69);
        $('tuner-note').textContent=getNoteLabel(n);
        const cents=1200*Math.log2(freq/(440*Math.pow(2,(n-69)/12)));
        $('tuner-needle').style.left=Math.max(0,Math.min(100,50+cents))+'%';
    }
}
function updatePitch(){
    if(!analyser||!audioCtx)return;
    const buf=new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    showPitch(autoCorrelate(buf,audioCtx.sampleRate));
    tunerRaf=requestAnimationFrame(updatePitch);
}
function autoCorrelate(buf,sr){
    let rms=0;for(let i=0;i<buf.length;i++)rms+=buf[i]*buf[i];
    if(Math.sqrt(rms/buf.length)<.01)return-1;
    let r1=0,r2=buf.length-1;
    for(let i=0;i<buf.length/2;i++)if(Math.abs(buf[i])<.2){r1=i;break}
    for(let i=1;i<buf.length/2;i++)if(Math.abs(buf[buf.length-i])<.2){r2=buf.length-i;break}
    buf=buf.slice(r1,r2);
    const c=new Array(buf.length).fill(0);
    for(let i=0;i<buf.length;i++)for(let j=0;j<buf.length-i;j++)c[i]+=buf[j]*buf[j+i];
    let d=0;while(c[d]>c[d+1])d++;
    let max=-1,pos=-1;
    for(let i=d;i<buf.length;i++)if(c[i]>max){max=c[i];pos=i}
    const denom=2*(c[pos+1]+c[pos-1]-2*c[pos]);
    return sr/(pos-(denom?((c[pos+1]-c[pos-1])/denom):0));
}

/* ============ 初期化 & イベント配線 ============ */
function init(){
    applyTheme();
    applyAccent();
    loadLibrary();
    if(!localStorage.getItem('cv_tuning')&&(songLibrary||[]).some(x=>x&&x.dropd)){tuningId='dropd';localStorage.setItem('cv_tuning','dropd')}
    loadPlaylists();
    renderTuningList();
    updateSettingsUI();
    if(songLibrary.length===0){songLibrary=[structuredClone(SAMPLE_SONG)];saveLibrary()}
    updateSongCount();
    renderSongList();
    renderPlaylistCollection();

    /* さきいかビルダーのブリッジは注入タイミングが前後しうるため、
       しばらくポーリングして検出でき次第システムバーの配色を反映する */
    (function(){let tries=0;const chk=()=>{if(window.Android&&Android.available&&Android.ui){syncSystemBars();return}if(++tries<40)setTimeout(chk,100)};chk()})();

    /* コード名タップ → 押さえ方ポップアップ */
    $('score-output').addEventListener('click',e=>{
        const el=e.target.closest('.chord-name');
        if(el&&!el.classList.contains('nc'))showChordPopup(el.dataset.chord,el.dataset.shown);
    });

    /* ライブラリ */
    $('add-song-btn').onclick=createNewSong;
    $('song-search').addEventListener('input',filterSongs);

    /* 選択バー */
    $('sel-cancel-btn').onclick=()=>{if(isSelectionMode)exitSelectionMode();if(isPlaylistSelectionMode)exitPlaylistSelectionMode()};
    $('sel-all-btn').onclick=()=>{
        if(isSelectionMode){songLibrary.forEach(s=>selectedSongIds.add(s.id));updateSelectionUI()}
        else if(isPlaylistSelectionMode){playlists.forEach(p=>selectedPlaylistIds.add(p.id));updateSelectionUI()}
    };
    $('sel-delete-btn').onclick=()=>{if(isSelectionMode)deleteSelectedSongs();else if(isPlaylistSelectionMode)deleteSelectedPlaylists()};

    /* 曲詳細 */
    $('detail-back-btn').onclick=()=>{if(history.state)history.back();else _closeSongDetailView()};
    $('edit-btn').onclick=enterEditMode;
    $('zoom-btn').onclick=toggleZoomPanel;
    $('scroll-btn').onclick=toggleScrollPanel;
    $('key-chip').onclick=openSettingsSheet;
    $('capo-chip').onclick=openSettingsSheet;
    $('mode-chip').onclick=openSettingsSheet;
    $('zoom-slider').addEventListener('input',updateZoomFromSlider);
    $('zoom-close-btn').onclick=closeZoomPanel;
    $('scroll-play-btn').onclick=toggleAutoScroll;
    $('scroll-close-btn').onclick=closeScrollPanel;
    $('chord-popup-close').onclick=closeChordPopup;

    /* 編集 */
    $('edit-back-btn').onclick=handleEditBack;
    $('save-btn').onclick=saveCurrentSong;

    /* 表示設定シート */
    document.querySelectorAll('#settings-sheet .settings-row[data-mode]').forEach(row=>{
        row.addEventListener('click',e=>{if(e.target.tagName==='SELECT')return;setMode(row.dataset.mode)});
    });
    $('diagram-row').onclick=toggleDiag;
    $('power-low-row').onclick=togglePowerLow;
    $('key-row').onclick=pickKey;
    $('capo-row').onclick=pickCapo;
    $('sheet-close-btn').onclick=closeSettingsSheet;
    $('sheet-close-x').onclick=closeSettingsSheet;
    $('settings-sheet').addEventListener('click',e=>{if(e.target===$('settings-sheet'))closeSettingsSheet()});

    /* プレイリスト */
    $('pl-add-btn').onclick=createPlaylist;
    $('pl-back-btn').onclick=()=>{if(history.state?.mode==='playlist_detail')history.back();else _closePlaylistDetail()};
    $('pl-addsong-btn').onclick=openSongPicker;
    $('picker-close-btn').onclick=closeSongPicker;
    $('picker-add-btn').onclick=addSongsToPlaylist;
    $('song-picker-modal').addEventListener('click',e=>{if(e.target===$('song-picker-modal'))closeSongPicker()});

    /* 設定 */
    $('notation-sharp-row').onclick=()=>setNotation('sharp');
    $('notation-flat-row').onclick=()=>setNotation('flat');
    $('theme-row').onclick=pickTheme;
    $('accent-row').onclick=pickAccent;
    $('export-row').onclick=exportData;
    $('import-row').onclick=openImportSheet;
    $('import-file-btn').onclick=()=>$('import-file').click();
    $('import-file').addEventListener('change',()=>{
        const f=$('import-file').files?.[0];
        $('import-file-name').textContent=f?`「${f.name}」を選択しました`:'';
    });
    $('import-go-btn').onclick=runImport;
    $('import-close-btn').onclick=closeImportSheet;
    $('import-modal').addEventListener('click',e=>{if(e.target===$('import-modal'))closeImportSheet()});
    $('backup-copy-btn').onclick=copyBackupText;
    $('backup-text-close-btn').onclick=()=>$('backup-text-modal').classList.remove('show');
    $('reset-row').onclick=resetAllData;

    /* PWA: Service Worker (https で配信されるブラウザ/PWA のみ。APK 内 file:// では登録しない) */
    if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)){
        navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }

    /* チューナー */
    $('tuner-toggle-btn').onclick=toggleTuner;

    /* URLハッシュから曲を復元 */
    const m=location.hash.match(/^#song=(.+)$/);
    if(m){
        const id=decodeURIComponent(m[1]);
        history.replaceState({mode:'song',songId:id},'',location.href);
        openSongDetail(id,false);
    }else{
        history.replaceState(null,'',location.pathname+location.search);
    }
}
window.addEventListener('load',init);
