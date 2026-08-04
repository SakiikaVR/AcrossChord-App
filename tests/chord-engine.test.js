'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const data=fs.readFileSync(path.join(root,'js','data.js'),'utf8');
const app=fs.readFileSync(path.join(root,'js','app.js'),'utf8');
const start=app.indexOf('/* ============ 音楽理論 ============ */');
const end=app.indexOf('/* ============ コードポップアップ ============ */');
assert.ok(start>=0&&end>start,'テスト対象のコードエンジン領域が見つかりません');

const context=vm.createContext({console});
vm.runInContext(data,context);
vm.runInContext(`
let notationMode='sharp',tuningId='std',powerLowOnly=false,diagramOn=true;
const __nodes={'score-output':{innerHTML:''}};
function $(id){return __nodes[id]||(__nodes[id]={})}
function closeChordPopup(){}
function escapeHTML(str){return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
${app.slice(start,end)}
`,context);

const run=code=>vm.runInContext(code,context);
const plain=html=>String(html).replace(/<[^>]+>/g,'');

assert.doesNotMatch(app,/artist\|a\|subtitle\|st/,'subtitleをartistとして保存しない');

const duplicateSong={mode:'text',capo:0,key:'C',artist:'歌： DOES　作詞・作曲： 氏原ワタル',content:'{subtitle: 歌: DOES 作詞・作曲: 氏原ワタル}\n{st:歌：  DOES  作詞・作曲：  氏原ワタル}\n[C]test'};
run(`renderScore(${JSON.stringify(duplicateSong)})`);
const dedupedSubtitle=run(`__nodes['score-output'].innerHTML`);
assert.equal((dedupedSubtitle.match(/class="meta-block"/g)||[]).length,1,'同じsubtitleは一度だけ表示する');
assert.doesNotMatch(dedupedSubtitle,/score-artist-line/,'subtitleと同じ旧artist表示を抑止する');

const distinctSong={mode:'text',capo:0,key:'C',artist:'DOES',content:'{subtitle:作詞・作曲：氏原ワタル}\n[C]test'};
run(`renderScore(${JSON.stringify(distinctSong)})`);
const distinctMetadata=run(`__nodes['score-output'].innerHTML`);
assert.equal((distinctMetadata.match(/score-artist-line/g)||[]).length,1,'異なるartistは維持する');
assert.equal((distinctMetadata.match(/class="meta-block"/g)||[]).length,1,'異なるsubtitleは維持する');

assert.deepEqual(
    JSON.parse(run(`JSON.stringify(parseChordSymbol('C6/9'))`)),
    {root:'C',suffix:'6/9',bass:'',bassSeparator:'/'}
);
assert.equal(run(`transposeChordName('C/G#',2)`),'D/A#');
assert.equal(run(`generateChordSvg('C','C','nns')`),'');

const nnsCases={
    'G7sus4add9':'57sus4add9',
    'Dmaj7':'2△7',
    'DmMaj7':'2-△7',
    'C7':'17',
    'C6':'16',
    'C9':'19',
    'C11':'111',
    'C13':'113',
    'Cadd9':'1add9',
    'Cadd11':'1add11',
    'Cadd13':'1add13',
    'C6/9':'1(69)',
    'Csus2':'1sus2',
    'Csus4':'1sus4',
    'Cdim7':'1dim7',
    'Cblk':'1blk',
    'C(4.4)':'1(4.4)',
    'C(4.3)':'1(4.3)',
    'C(#5)':'1(5#)',
    'C(b5)':'1(-5)',
    'C(#9)':'1(9#)',
    'C(b9)':'1(-9)',
    'C(#11)':'1(11#)',
    'C(#13)':'1(13#)',
    'C(b13)':'1(-13)',
    'Comit3':'1omit3',
    'C/G#':'1/5#',
};
for(const [chord,expected] of Object.entries(nnsCases)){
    assert.equal(plain(run(`getDegreeHTML(${JSON.stringify(chord)},'C')`)),expected,chord);
}
run(`renderScore({mode:'nns',capo:0,key:'C',artist:'',content:'先頭[C6/9]A [C/G#]B [Dmaj7]C [G7sus4add9]D'})`);
const renderedNns=run(`__nodes['score-output'].innerHTML`);
assert.doesNotMatch(renderedNns,/<svg|chord-diagram|segment-chord/, 'NNSでは図と図用領域を生成しない');
assert.match(plain(renderedNns),/1\(69\).*1\/5#.*2△7.*7sus4add9/s);
run(`renderScore({mode:'nns',capo:0,key:'C',artist:'',content:'[2△7]直接入力'})`);
const rejectedDirectNns=run(`__nodes['score-output'].innerHTML`);
assert.match(rejectedDirectNns,/class="chord-name nc"/, '数値NNSはコードとして直接解析しない');
assert.doesNotMatch(rejectedDirectNns,/class="cn-root"/, '数値NNSをNNSコード表示へ変換しない');

const tunings=['std','dropd','half','dropcs','whole','dropc','dropb'];
const roots=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
for(const tuning of tunings){
    run(`tuningId=${JSON.stringify(tuning)};chordSvgCache.clear()`);
    for(const lowOnly of [false,true]){
        run(`powerLowOnly=${lowOnly}`);
        for(const note of roots){
            const svg=run(`generateChordSvg(${JSON.stringify(note)},${JSON.stringify(note+'5')},'power')`);
            assert.match(svg,/class="chord-diagram"/,`${tuning} ${note}5 のSVG`);
            assert.match(svg,/class="(?:fretted-note|open-note)"/,`${tuning} ${note}5 の発音位置`);
            assert.doesNotMatch(svg,/undefined|NaN/,`${tuning} ${note}5 の無効値`);
        }
    }
}

run(`tuningId='dropd';powerLowOnly=false;chordSvgCache.clear()`);
const dropDOpen=run(`generateChordSvg('D','D5','power')`);
assert.equal((dropDOpen.match(/class="open-note"/g)||[]).length,3,'Drop DのD5は低音3弦の開放位置を明示する');

for(const tuning of tunings){
    run(`tuningId=${JSON.stringify(tuning)};powerLowOnly=false;chordSvgCache.clear()`);
    for(const note of roots){
        for(const suffix of ['', 'm', '7', 'maj7', 'sus4', 'add9', 'dim7', '13(#11)']){
            const chord=note+suffix;
            const svg=run(`generateChordSvg(${JSON.stringify(chord)},${JSON.stringify(chord)},'text')`);
            assert.match(svg,/class="chord-diagram"/,`${tuning} ${chord} のSVG`);
            assert.match(svg,/class="(?:fretted-note|open-note)"/,`${tuning} ${chord} の発音位置`);
            assert.doesNotMatch(svg,/undefined|NaN/,`${tuning} ${chord} の無効値`);
        }
    }
}

for(const chord of ['Cmaj13(#11)','F#m7b5','Bbadd13','E#sus2','Cbblk','D(4.4)/A']){
    const svg=run(`tuningId='std';generateChordSvg(${JSON.stringify(chord)},${JSON.stringify(chord)},'text')`);
    assert.match(svg,/class="chord-diagram"/,`${chord} のSVG`);
    assert.match(svg,/<circle /,`${chord} の押弦点`);
}

console.log('chord-engine: all tests passed');
