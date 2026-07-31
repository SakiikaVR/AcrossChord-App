<p align="center">
  <img src="icons/icon.png" width="120" alt="アクロスコード icon" />
</p>

<h1 align="center">アクロスコード (AcrossChord)</h1>

<p align="center"><b>コード譜の作成・閲覧からギターチューナーまで、これ 1 つのコード譜アプリ</b></p>

<p align="center">
  サーバー不要・アカウント不要。データはすべて端末内に保存されます。
  本体は<b>外部ライブラリ非依存の HTML + JavaScript</b> で、
  Android 用 APK は <a href="https://github.com/SakiikaVR/Sakiika-Builder">さきいかビルダー</a> でビルドしています。
</p>

<p align="center">
  <a href="https://github.com/SakiikaVR/AcrossChord-App/releases/latest">
    <img src="https://img.shields.io/github/v/release/SakiikaVR/AcrossChord-App?style=for-the-badge&label=%E2%AC%87%20APK&color=e05a2b" alt="APK ダウンロード" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License" />
  </a>
</p>

---

## 🚀 クイックスタート

| 環境 | 手順 |
|---|---|
| 🤖 **Android** | **[📦 最新リリース](https://github.com/SakiikaVR/AcrossChord-App/releases/latest)** から `AcrossChord-x.x.x.apk` をダウンロードして開き、インストール |
| 🌐 **ブラウザ** | リポジトリをダウンロード (Code → Download ZIP) して [index.html](index.html) をブラウザで開くだけ |

> インストールもアカウントも不要。完全にオフラインで動作します。
> マイク権限はクロマチックチューナー機能でのみ使用します。

## ✨ 機能

- 📚 **コード譜ライブラリ** — 五十音・アルファベットのインデックス付き一覧、曲名・アーティスト・本文のインクリメンタル検索、長押しでまとめて削除
- 🎼 **プレイリスト** — 作成・曲の追加/削除・まとめて削除
- ✏️ **ChordPro 互換エディタ** — `{title:}` `{artist:}` `{key:}` などのメタ情報、`{c: コメント}`、歌詞中の `[C]` `[Am7]` `[Eb/G]` 埋め込みに対応。他の ChordPro 対応アプリの譜面をそのまま貼り付け可能
- 👆 **タップでコードダイアグラム** — コード名をタップするとギターの押さえ方をポップアップ表示。常時表示モードも選択可能
- 🔀 **自動移調** — Key の変更・Capo (0–11) 指定、♯/♭ 表記切替、コード名 / パワーコード (5th) / NNS (度数) の表示切替
- 🎸 **7 種のチューニング対応** — Standard / Drop D / 半音下げ / Drop C# / 全音下げ / Drop C / Drop B。ダイアグラムは選択中のチューニングに合わせて自動変換
- 🎤 **クロマチックチューナー** — マイク入力から自己相関法でピッチを検出し、音名・周波数・セント単位のズレをメーター表示
- 📜 **オートスクロール** — 速度調整つき。ズームは 50%–300%
- 🎨 **テーマ切替** — ダーク / ライトテーマ、アクセントカラーの変更
- 💾 **データ管理** — ライブラリを JSON でエクスポート / インポート (マージ)、全データ削除
- 🚫 **依存ゼロ** — 外部ライブラリなし・ビルド不要・通信なし

## ✏️ 記法の例

```
{title: ふるさと}
{artist: 文部省唱歌}
{key: C}

[C]うさぎ[F]おいし[G7]かのや[C]ま
```

右下の **＋** ボタンで新規曲を作成し、上のように入力して保存すると、
歌詞の上にコード名が配置されたコード譜として表示されます。

## ⚙️ 仕組み

| 部分 | 実装 |
|---|---|
| データ保存 | 端末内の `localStorage` のみ (サーバー送信なし)。JSON でエクスポート / インポート可能 |
| コードダイアグラム | 選択中のチューニングに合わせてポジションを自動変換して描画 |
| チューナー | `getUserMedia` のマイク入力を自己相関法で解析してピッチ検出 |
| 移調 | Key / Capo / 表記 (♯・♭・NNS) をレンダリング時に一括変換 |
| Android 版 | [さきいかビルダー](https://github.com/SakiikaVR/Sakiika-Builder) 0.2.1 の WebView ランタイムに同じ HTML を格納。ビルド所要は**数十ミリ秒** |

## 📂 ファイル構成

```
AcrossChord-App/
├── index.html     # アプリ本体 (HTML / CSS)
├── js/
│   ├── data.js    # 音楽理論データ (コードシェイプ・チューニングなど)
│   └── app.js     # アプリケーションロジック
├── icons/
│   └── icon.png   # アイコン (APK 用)
└── sakiika.json   # さきいかビルダーのビルド設定 (Android 版)
```

## ❓ トラブルシューティング

| 症状 | 対処 |
|---|---|
| チューナーが反応しない | マイク権限を許可してください。拒否した場合は Android の設定 → アプリ → アクロスコード → 権限 から変更できます |
| 「アプリがインストールされていません」(Android) | 同じパッケージ名で別の鍵で署名したアプリが入っています。一度アンインストールしてください |
| 「提供元不明のアプリ」と言われる (Android) | ストア外の APK なので初回のみ「この提供元を許可」が必要です |
| データを別の端末に移したい | 設定 → エクスポートで JSON を書き出し、移行先でインポートしてください |
| ブラウザ版とアプリ版でデータが違う | 保存先 (`localStorage`) がそれぞれ別のため、データは共有されません。JSON エクスポート / インポートで移行できます |

## 💻 動作環境

- 🤖 Android 版 APK: **Android 9.0 (API 28) 以上**。必要な権限は `RECORD_AUDIO` (チューナー用) のみ
- 🌐 Web 版: Chrome / Edge / Safari など最近のブラウザ (スマホ・PC どちらでも)
- 📴 オフライン: 通信は一切行いません

## 📄 ライセンス

- 本リポジトリは **MIT** で公開しています ([LICENSE](LICENSE))
- APK のビルドには [さきいかビルダー](https://github.com/SakiikaVR/Sakiika-Builder) (MIT) を使用しています

## 🛠️ 開発者向け

```powershell
git clone https://github.com/SakiikaVR/AcrossChord-App.git
cd AcrossChord-App
# ローカルで確認: index.html をそのままブラウザで開くだけ
```

APK を作り直すときは [さきいかビルダー](https://github.com/SakiikaVR/Sakiika-Builder) の CLI と
リポジトリ同梱の [sakiika.json](sakiika.json) を使います。

```powershell
# web ファイルをステージング (www/ は .gitignore 済み)
New-Item -ItemType Directory -Force www\js | Out-Null
Copy-Item index.html www\
Copy-Item js\* www\js\

sakiika build .\sakiika.json
```

> 署名鍵 `sakiika-key.pem` は出力フォルダーに作られます。**Android は同じ証明書でないと上書き更新を
> 受け付けないため、この鍵は必ず保管してください** (このリポジトリには含めていません)。
