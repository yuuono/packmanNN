---
marp: true
theme: default
size: 16:9
paginate: true
lang: ja
title: パックマンの進路選択と utility-based AI
description: ニューラルネットワークが何を重視するか決めて各方向の得点で進む道を選ぶ仕組み
style: |
  section {
    background: #fff;
    color: #222;
    color-scheme: light;
    font-family: "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif;
    font-size: 28px;
    line-height: 1.45;
    padding: 48px 80px;
    font-variant-numeric: tabular-nums;
  }
  h1, h2 { color: #111; letter-spacing: -0.03em; line-height: 1.25; }
  h1 { font-size: 52px; }
  h2 { font-size: 43px; }
  strong, a, a:visited, a:hover, a:active { color: #111; }
  a { text-decoration: underline; }
  p { margin: 0.5em 0; }
  p > img { display: block; width: 100%; height: auto; background: transparent; }
  table { font-size: 0.94em; margin: 0.55em 0; }
  table th, table td { border: 1px solid #c8c8c8; padding: 0.28em 0.8em; }
  table th { background: #f0f0f0; color: #111; }
  table tr, table tr:nth-child(2n) { background: #fff; }
  blockquote { color: #111; background: #f6f6f6; border-left: 5px solid #444; padding: 0.2em 0.65em; }
  section::after { color: #555; font-size: 16px; }
  section.junction ul, section.flow ol {
    display: grid; list-style: none; padding: 0; margin: 22px 0; gap: 26px;
  }
  section.junction li, section.flow li {
    padding: 16px 12px; margin: 0; text-align: center; border: 2px solid #aaa;
    border-radius: 6px; background: #fafafa; color: #111;
  }
  section.junction ul {
    grid-template-columns: repeat(3, 185px); grid-template-areas: ". n ." "w p e" ". s .";
    gap: 5px; justify-content: center;
  }
  section.junction li { font-size: 25px; padding: 12px 8px; }
  section.junction li:nth-child(1) { grid-area: n; }
  section.junction li:nth-child(2) { grid-area: w; }
  section.junction li:nth-child(3) { grid-area: p; background: #fff; border-color: #222; }
  section.junction li:nth-child(4) { grid-area: e; background: #e6e6e6; border-color: #aaa; }
  section.junction li:nth-child(5) { grid-area: s; }
  section.flow ol { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 38px; }
  section.flow li { position: relative; font-size: 22px; }
  section.flow li strong { display: block; margin-bottom: 6px; font-size: 28px; }
  section.flow li br { display: none; }
  section.flow li:not(:last-child)::after {
    content: "→"; position: absolute; top: 50%; left: calc(100% + 2px);
    transform: translateY(-50%); width: 34px; color: #444; font-size: 26px;
  }
  section.roles ol { gap: 64px; margin: 25px 0; }
  section.roles li { font-size: 25px; padding: 18px 10px; }
  section.roles li br { display: inline; }
  section.roles li strong + br { display: none; }
  section.roles li:not(:last-child)::after { width: 60px; }
  section.inputs table { font-size: 23px; }
  section.inputs th, section.inputs td { padding: 0.28em 0.6em; }
---

<!-- _class: junction -->

# パックマンの進路選択と utility-based AI

ゴースト2体の迷路で右へ3手　上へ2手進んだ交差点

- ↑ 上のエサ
- ← 左のエサ
- **現在地**
- 壁
- ↓ 通過済み

エサを取りやすい **上の道** と　敵との距離に余裕がある **下の道**

---

<!-- _class: flow roles -->

## 進む道を決めるまでの2段階

1. **何を重視するか**\
   ニューラルネットワーク（NN）が\
   盤面の12個の数値から4項目の重みを決める
2. **どの道を選ぶか**\
   utility-based AI が各方向の4項目を採点\
   各点に重みを掛けて合計が最大の道へ進む

4つの項目は **近くのエサ　全体の集めやすさ　敵からの安全　パワーの活用**

同じ交差点でも均等配分なら上へ　安全を重視した例では下へ

公開デモでは人がスライダーで重みを設定　学習済みモデルを読み込むと NN が担当

---

<!-- _class: inputs -->

## NN が見る盤面の12個の数値

1ページ目の交差点での入力値　すべて0〜1

| 入力 1〜6 | 値 | 入力 7〜12 | 値 |
|:---|---:|:---|---:|
| 全エサの残り割合 | 0.964 | 最寄りの先回り型の敵の近さ | 0 |
| パワーエサの残り割合 | 1 | こちらに向かっている敵の割合 | 0 |
| パワーの残り時間の割合 | 0 | 進める方向の数 ÷ 4 | 0.75 |
| 最寄りの通常エサの近さ | 0.800 | 敵より先に抜けられそうな方向の数 ÷ 4 | 0.50 |
| 最寄りのパワーエサの近さ | 0.308 | 4歩以内の通路で通常エサがあるマスの割合 | 0.632 |
| 最寄りの追跡型の敵の近さ | 0.364 | 残りの全エサまでの平均距離 ÷ 32　上限1 | 0.296 |

近さは通路距離が短いほど1に近づく　待機中の敵は対象外　対象がなければ0\
この交差点は **進める道が3本**　そのうち **敵より先に抜けられそうな道が2本**

---

## 進路の採点に使う応答曲線の一覧

応答曲線は距離や個数などの観測値を評価点に変える関数

| 頁 | 採点項目 | 入力と得点の関係 |
|---:|:---|:---|
| 5 | 目先の採餌 | エサの数に比例して加点　距離で減衰 |
| 6 | 全体の回収 | 推定歩数が短い候補ほど高得点 |
| 7 | 慎重さ | 余裕が増すと直線的に上昇　両端で一定 |
| 8 | パワー活用　通常時 | エサに近いほど加点　敵の近さで増幅 |
| 9 | パワー活用　パワー中 | 時間内に届くときだけ敵の近さで加点 |

同じ4項目を毎手採点　パワー活用の式は効果の有無で切り替わる

---

## 目先の採餌　個数と距離の加点

最初の1歩を固定し引き返さずに4手で拾える最大数を調べる\
通常のエサもパワーエサも1個として数える

![4手で拾える最大数に比例する加点と最寄りのエサまでの距離に応じて減る加点](figures/response-local.svg)

目先の点 ＝ 0.65 × 最大数 ÷ 4 ＋ 0.35 ÷（1 ＋ 距離）

上は4個と距離0で **1点**　下は2個と距離2で **約0.442点**

---

## 全体の回収　他の候補との歩数差

各方向へ踏み出した後に近いエサから順に回収すると仮定して全回収までの歩数を見積もる

![交差点での候補の最大最小の差が12歩の場合と2歩の場合の得点を比較するグラフ](figures/response-global.svg)

全体の点 ＝（最長歩数 − その方向の歩数）÷ 分母\
分母は最長と最短の差　差が4歩未満なら4を使う

候補間の差が2歩なら最短でも **0.5点**　全候補が同じ歩数なら **すべて0点**

---

## 慎重さ　通路で最も小さい到着余裕

次の分岐か行き止まりまでの各マスで **敵の最短距離 − 自分の歩数** を比較\
途中にパワーエサがあればその手前までを調べる

![最小の到着余裕がマイナス2以下なら0点　7以上なら1点　その間は直線的に増えるグラフ](figures/utility-response.svg)

慎重さ ＝（最小の余裕 ＋ 2）÷ 9 を0〜1に収めた値

左に6マス進むと敵はそこまで3マス　最小の余裕が **−3** なので **0点**\
パワー中や活動中の敵がいないときは全方向が **1点**

---

## 通常時のパワー活用　エサと敵の距離

パワーエサの距離は **1歩先** から　敵の距離は **現在地** から測る

![エサまでの距離と敵までの距離を個別に変えたときの通常時のパワー活用の得点](figures/response-power-normal.svg)

近さ ＝ 1 ÷（1 ＋ 距離 ÷ 4）\
パワーの点 ＝ エサの近さ ×（0.55 ＋ 0.45 × 敵の近さ）

活動中の敵がいなければ係数は **0.55**　パワーエサが尽きると **0点**

---

## パワー中の追跡　距離と残り時間の境界

1歩先から活動中の敵までの最短距離を使う　最初の1歩にも1手かかる

![残り4手での距離別の得点と敵まで3マスでの残り手数別の得点](figures/response-power-active.svg)

**距離 ＋ 1 ≦ 残り手数** なら点は 1 ÷（1 ＋ 距離 ÷ 4）　届かなければ **0点**

敵まで3マスなら残り3手で **0点**　残り4手で **約0.57点**\
活動中の敵がいなければ0点　効果が切れると通常時の採点へ戻る

---

## 同じ交差点での3方向の評価点

| 方向 | 目先の採餌 | 全体の回収 | 慎重さ | パワー活用 |
|:---|---:|---:|---:|---:|
| ↑ 上 | **1.000** | **1.000** | 0.556 | 0.204 |
| ↓ 下 | 0.442 | 0.833 | **1.000** | 0.238 |
| ← 左 | **1.000** | 0.000 | 0.000 | 0.204 |

上はすぐにエサを取れて残りのエサも回りやすい\
下はエサを取りにくい一方でゴーストとの距離に余裕がある

**均等配分で上に進むときの総合点**\
0.25 × 1 ＋ 0.25 × 1 ＋ 0.25 × 0.556 ＋ 0.25 × 0.204 ≈ **0.690**

---

## 重みの配分による進路の逆転

![方向ごとの得点内訳を示す積み上げ棒グラフ　均等配分では上が首位　慎重さを70%にすると下が首位](figures/utility-weights.svg)

左は手動の初期値　右は仕組みを示すための固定配分の例\
NN が右と同じ配分を返す場合も上は **0.649点**　下は **0.861点** となり下へ進む

---

<!-- _class: flow -->

## 重みを選ぶタイミングと移動の間隔

1. **NN の入力**\
   エサの残量や敵の近さなど盤面の12特徴量
2. **隠れ層の ReLU**\
   16個のユニットで特徴を合成して負の値を0に変換
3. **出力の softmax**\
   4つの出力を合計100%の配分に変換

| ブラウザでの判断 | 初回 | 通路の各マス | 次の交差点 |
|:---|:---|:---|:---|
| NN が決める重み | 配分を決める | 同じ配分を使う | 配分を決め直す |
| 進む方向 | 採点して選ぶ | 毎手採点して選ぶ | 採点して選ぶ |

交差点は出口が3つ以上のマス　移動は1手160ミリ秒\
同点なら直進を優先　次に 上 → 左 → 下 → 右 の順

---

<!-- _class: flow -->

## サーバーでの学習とブラウザへの受け渡し

1. **交差点の収集**\
   Behavior Tree や重みを固定した自動操縦で迷路をプレイ
2. **配分の比較**\
   同じ交差点から5種類の固定配分でそれぞれ最大32手を試行
3. **重みの学習**\
   成績に差がついた交差点で最も良かった配分を学習
4. **デモでの推論**\
   学習済みモデルを読み込み新しい盤面の重みを決める

Behavior Tree の役割は学習に使う盤面の収集\
学習した NN が決めるのは **4項目の重み**　各方向の点数はゲームに組み込んだ式で計算

---

## デモでの進路とゴースト数の比較

**同じ盤面で重みを変える**\
ゴーストが近い交差点で一時停止して慎重さのスライダーを動かす\
矢印の横の総合点を見てから再開すると選ばれた方向を確かめられる

**同じ重みでゴースト数を変える**\
0体なら全方向の慎重さは1点　4体なら各マスに最短で届く活動中の敵を参照\
待機中の敵は除外　パワー中は全方向の慎重さが1点

[標準の2体で開始](https://yuuono.github.io/packmanNN/?agent=utility)　 [0体で比較](https://yuuono.github.io/packmanNN/?agent=utility&ghosts=0)　 [4体で比較](https://yuuono.github.io/packmanNN/?agent=utility&ghosts=4)

[採点式の実装](https://github.com/yuuono/packmanNN/blob/main/ai/utility.js)　 [NNの呼び出し条件](https://github.com/yuuono/packmanNN/blob/main/ai/controller.js)　 [学習方針](https://github.com/yuuono/packmanNN/blob/main/TRAINING_PLAN.md)

名称と応答曲線の出典　[Mike Lewis　Game AI Pro 3 第13章　175ページ](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf#page=9)
