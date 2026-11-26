# Maze Chase

パックマン風の1人用迷路ゲーム。追跡するピンクのゴーストと、先回りする水色のゴーストをかわして、すべてのドットとパワーエサを回収するとクリアです。ブラウザ上で動きます。

## GitHub Pagesで遊ぶ

GitHubのリポジトリで **Settings → Pages → Build and deployment** を開き、**Source** で **Deploy from a branch** を選びます。ブランチを **main**、フォルダーを **/ (root)** にして **Save** を押してください。公開後、同じ画面に表示される **Visit site** のURLを共有できます。ビルドや外部サービスの設定は不要です。

## 操作

- 「ゲーム開始」、矢印キー、WASDのいずれかで開始します。進みたい方向を少し早めに入力すると、曲がれる交差点で曲がります。
- 迷路の下の「ゴースト数」で0〜4体を選べます。初期設定は追跡型と先回り型の2体です。プレイ中に変更すると、新しい体数で最初から遊ぶかを選べます。体数はURLに反映されるので、同じ条件を共有できます。[ゴースト4体の自動操縦デモ](https://yuuono.github.io/packmanNN/?agent=utility&ghosts=4)
- スマートフォンでは方向ボタンか迷路上のスワイプで移動します。
- スペースまたは「一時停止」で中断・再開できます。タブを離れると自動で一時停止します。
- サウンドは右上で切り替えられます。ベストスコアは同じブラウザに、手動・自動操縦とゴースト数の組み合わせごとに保存されます。
- ライフは3つ。ドットは10点、パワーエサは50点。パワーエサを取ると約8秒間、青いゴーストを捕まえて追加点を得られます。

## 手元で起動する

リポジトリ直下で以下を実行し、ブラウザで [localhost:8000](http://localhost:8000/) を開きます。

```sh
python3 -m http.server 8000
```

## 性格スライダーの実験

「AI実験」では、4つの重みを変えて自動操縦を試せます。学習済みモデルはサーバーで生成してから、JSONファイルとしてブラウザに読み込みます。[学習方針、JSONL仕様、サーバー実行手順](TRAINING_PLAN.md)

## utility-based AI の設計スライド

NN はエサや敵の状態から、4つの項目をどれだけ重視するか決めます。ゲームは通れる方向ごとに4項目を採点し、各点に重みを掛けて合計が最大の方向へ進みます。[役割分担（PDF 2ページ）](https://yuuono.github.io/packmanNN/docs/utility-ai.pdf#page=2) ／ [NN に入る12個の値（3ページ）](https://yuuono.github.io/packmanNN/docs/utility-ai.pdf#page=3)

目先の採餌、全体の回収、慎重さ、パワー活用の4項目について、入力から得点への変化を5〜9ページのグラフで示しています。[応答曲線の一覧（4ページ）](https://yuuono.github.io/packmanNN/docs/utility-ai.pdf#page=4) ／ [重みの更新と学習（12〜13ページ）](https://yuuono.github.io/packmanNN/docs/utility-ai.pdf#page=12) ／ [編集用の Marp Markdown](docs/utility-ai.md)

Marp for VS Code のプレビューで閲覧できます。Marp CLI を使う場合は、リポジトリ直下から次のコマンドで発表用の HTML を作成できます。

```sh
marp docs/utility-ai.md -o docs/utility-ai.html
```

HTML を別の場所に移すときは、同じ階層に `docs/figures/` を `figures/` としてコピーしてください。

公開用 PDF は `marp --allow-local-files --pdf docs/utility-ai.md -o docs/utility-ai.pdf` で更新できます。
