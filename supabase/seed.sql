-- note Growth OS: ローカル開発用デモデータ(セクション15)。
--
-- 重要: このファイルは Supabase CLI の規約により `supabase db reset` / `supabase start` を
-- 実行したときの「ローカルスタック」にのみ自動投入され、`supabase db push` でリンク済みの
-- 本番/リモートプロジェクトへ流し込まれることは一切ない。本番へ誤って投入する経路が
-- 存在しないという性質そのものを「dev/test限定」の担保として利用している。
--
-- デモユーザー(固定UUID)。auth.usersへのINSERTがトリガー経由でpublic.usersを自動生成する。
insert into auth.users (id, email)
values ('a0000000-0000-0000-0000-000000000001', 'demo@example.com')
on conflict (id) do nothing;

-- ============================================================
-- Research items(20件): 8テーマ × 未分析/分析済みを混在させる
-- ============================================================
insert into public.gos_research_items (
  id, user_id, source_type, source_name, source_url, keyword, title, summary, raw_text,
  target_age_min, target_age_max, harm_types, surface_problem, deep_problem, emotional_trigger,
  trend_score, pain_score, status, collected_at, content_hash, analysis_version, last_analyzed_at
) values
-- 各行は以下22列の順で値を並べる:
-- id, user_id, source_type, source_name, source_url, keyword, title, summary, raw_text,
-- target_age_min, target_age_max, harm_types, surface_problem, deep_problem, emotional_trigger,
-- trend_score, pain_score, status, collected_at, content_hash, analysis_version, last_analyzed_at
--
-- 会社依存
('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'SNS', 'X(旧Twitter)', null, '会社依存 早期退職', '早期退職募集のポストに「会社に人生を預けていた」というコメントが多数付いている', '大手メーカーの早期退職募集のニュースに対し、対象年齢の会社員から「会社に人生を預けていた自分に気づいた」という共感コメントが200件以上付いている。', null,
 50, 59, array['Ambition','Money'], '早期退職の対象になるかもしれない不安', '会社という後ろ盾を失った時、自分に何が残るのか分からない恐怖', '早期退職募集のニュース',
 78, 82, 'REVIEWED', now() - interval '3 days', 'seed-hash-1', 1, now() - interval '3 days'),
('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'NEWS', '日経電子版', null, '45歳定年制', '45歳定年制の議論が再燃し、SNSで50代会社員が反応している', null, null,
 50, 57, array[]::text[], null, null, null, null, null, 'NEW', now() - interval '1 day', null, 0, null),
('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'SEARCH', 'Google検索', null, '会社辞めたい 50代 怖い', '「会社を辞めたいが怖い」という悩み相談サイトの投稿が上位表示される', null, null,
 48, 59, array['Ambition'], '会社を辞める決断ができない', '転職市場での自分の市場価値が分からないことへの恐怖', 'なし',
 65, 74, 'REVIEWED', now() - interval '10 days', 'seed-hash-3', 1, now() - interval '10 days'),
-- AI失業不安
('10000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'NEWS', 'ITmedia', null, '生成AI 事務職 削減', '大手企業が生成AI導入で事務職を段階的に削減する方針を発表', '大手企業が生成AI導入により今後3年で事務職を3割削減する方針を発表。対象年齢層の社員から不安の声。', null,
 45, 59, array['Ambition','Money'], 'AIに仕事を奪われるかもしれない不安', '自分のスキルがAI以下だと証明されることへの恐怖', '大手企業のAI導入・人員削減の報道',
 88, 80, 'REVIEWED', now() - interval '2 days', 'seed-hash-4', 1, now() - interval '2 days'),
('10000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'SNS', 'Threads', null, 'AIで仕事なくなる 50代', 'ChatGPTに自分の仕事内容を要約させたら5秒で終わり愕然としたという投稿がバズっている', null, null,
 45, 59, array['Ambition'], '自分の仕事がAIで代替可能だと気づいた', '20年かけて積んだ経験が無価値化する恐怖', 'ChatGPTで自分の業務を再現できた体験',
 91, 85, 'REVIEWED', now() - interval '1 day', 'seed-hash-5', 1, now() - interval '1 day'),
('10000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'MANUAL', '同僚へのヒアリング', null, 'AI 経理 不安', '経理部の同僚が「請求書処理はもうAIで十分」と話していた', null, null,
 48, 58, array[]::text[], null, null, null, null, null, 'NEW', now() - interval '5 days', null, 0, null),
-- 定年
('10000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'NEWS', '朝日新聞デジタル', null, '定年後 再雇用 給与半減', '定年後の再雇用で給与が半減する制度の実態を報じる記事', '60歳定年後の再雇用で給与が半減するケースが多く、モチベーション低下が課題という調査結果。', null,
 55, 59, array['Money'], '定年後に給与が大きく下がる', '「同じ仕事をしているのに評価されない」という尊厳の喪失', '定年・再雇用のニュース',
 60, 76, 'REVIEWED', now() - interval '15 days', 'seed-hash-7', 1, now() - interval '15 days'),
('10000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'SEARCH', 'Yahoo!知恵袋', null, '定年後 何もすることがない', '定年退職者が「何もすることがなく毎日が不安」と相談している', null, null,
 55, 65, array['Health','Ambition'], '定年後の時間を持て余す', '仕事以外に自分のアイデンティティがないことへの気づき', '定年退職・肩書きの喪失',
 55, 70, 'REVIEWED', now() - interval '20 days', 'seed-hash-8', 1, now() - interval '20 days'),
-- 副業
('10000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'SNS', 'X(旧Twitter)', null, '副業 何から始める 50代', '50代から副業を始めたいが何をすればいいか分からないという投稿への反応が多い', null, null,
 45, 59, array['Money','Ambition'], '副業を始めたいが何をすればいいか分からない', '「特別なスキルがない自分には無理」という思い込み', '周囲の副業成功談',
 70, 68, 'REVIEWED', now() - interval '4 days', 'seed-hash-9', 1, now() - interval '4 days'),
('10000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'URL', '個人ブログ', 'https://example.com/blog/side-job-50s', '副業 失敗談', '副業のノウハウ商材を買って失敗した50代のブログ記事', null, null,
 48, 59, array['Money'], '副業の情報商材で失敗した', '「またお金を失うかもしれない」という副業自体への不信感', '過去の副業詐欺被害',
 50, 60, 'REVIEWED', now() - interval '25 days', 'seed-hash-10', 1, now() - interval '25 days'),
('10000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'MANUAL', '知人からの情報', null, '副業 note 収益化', 'noteで副業を始めた知人の話', null, null,
 45, 55, array[]::text[], null, null, null, null, null, 'NEW', now() - interval '2 days', null, 0, null),
-- 転職
('10000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'NEWS', '東洋経済オンライン', null, '50代 転職 厳しい現実', '50代の転職成功率と厳しい現実についての特集記事', '50代の転職成功率は20代の1/5程度というデータと、成功した人の共通点を紹介する特集。', null,
 50, 59, array['Ambition','Money'], '転職市場での自分の価値が分からない', '「今の会社でしか通用しない人材」だと突きつけられる恐怖', '転職特集記事・データ',
 72, 77, 'REVIEWED', now() - interval '7 days', 'seed-hash-12', 1, now() - interval '7 days'),
('10000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'SEARCH', 'Google検索', null, '50代 転職 職務経歴書', '50代向けの職務経歴書の書き方を検索する人が急増', null, null,
 48, 59, array['Ambition'], '職務経歴書の書き方が分からない', '自分の20年のキャリアを言語化できないもどかしさ', '転職エージェントとの面談',
 58, 55, 'REVIEWED', now() - interval '12 days', 'seed-hash-13', 1, now() - interval '12 days'),
-- 市場価値
('10000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 'SNS', 'LinkedIn', null, '市場価値 棚卸し 50代', '50代でキャリアの棚卸しをした投稿が話題', null, null,
 45, 59, array['Ambition'], '自分の市場価値を客観視できていない', '社外に出た瞬間に「ただの人」になる恐怖', '同世代の転職成功事例',
 66, 71, 'REVIEWED', now() - interval '6 days', 'seed-hash-14', 1, now() - interval '6 days'),
('10000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'MANUAL', '社内アンケート結果', null, '市場価値 不安', '社内アンケートで「自分の市場価値に自信がない」と回答した50代が7割', null, null,
 45, 59, array[]::text[], null, null, null, null, null, 'NEW', now() - interval '8 days', null, 0, null),
-- 老後
('10000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000001', 'NEWS', 'NHKニュース', null, '老後資金 2000万円問題', '老後資金2000万円問題が再燃し、50代の関心が高まっている', '金融庁の報告書を発端とした老後資金2000万円問題が数年経った今も50代の関心事として再燃している。', null,
 50, 59, array['Money'], '老後資金が足りるか分からない', '「今の生活水準を維持できないかもしれない」という将来への漠然とした不安', '年金・老後資金関連のニュース',
 62, 79, 'REVIEWED', now() - interval '18 days', 'seed-hash-16', 1, now() - interval '18 days'),
('10000000-0000-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000001', 'SEARCH', 'Google検索', null, '新NISA 50代から', '50代から新NISAを始める人向けの検索需要が増加', null, null,
 50, 59, array['Money'], '資産形成を何から始めればいいか分からない', '「もう遅いのでは」という焦り', '周囲の新NISA活用の話題',
 74, 62, 'REVIEWED', now() - interval '9 days', 'seed-hash-17', 1, now() - interval '9 days'),
-- 人生再設計
('10000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000001', 'SNS', 'X(旧Twitter)', null, '人生100年時代 50代', '「人生100年時代、50代はまだ折り返し地点」という投稿に共感が集まっている', null, null,
 45, 59, array['Ambition','Health'], '残りの人生をどう生きるか分からない', '「このままでいいのか」という漠然とした焦り', '同世代の訃報・体調不良のニュース',
 69, 66, 'REVIEWED', now() - interval '11 days', 'seed-hash-18', 1, now() - interval '11 days'),
('10000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000001', 'URL', '個人ブログ', 'https://example.com/blog/second-life-50s', '第二の人生 会社員', '会社員を続けながら第二の人生を準備した人のブログ', null, null,
 48, 59, array['Ambition'], '会社員以外の自分を想像できない', '会社の肩書きを失った後の自分に価値を感じられるか不安', '定年を迎えた先輩の姿',
 57, 64, 'REVIEWED', now() - interval '14 days', 'seed-hash-19', 1, now() - interval '14 days'),
('10000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', 'MANUAL', '書籍からのメモ', null, '人生再設計 50代', '「50代からの人生戦略」という書籍の要点メモ', null, null,
 45, 59, array[]::text[], null, null, null, null, null, 'NEW', now() - interval '1 day', null, 0, null)
on conflict (id) do nothing;

-- ============================================================
-- Content ideas(15件): スコア帯・ステータスを混在させる
-- ============================================================
insert into public.gos_content_ideas (
  id, user_id, research_item_id, title, summary, hook, angle, target_persona, core_problem, harm_types,
  demand_score, pain_score, willingness_to_pay_score, competition_opportunity_score, trend_score,
  threads_virality_score, note_fit_score, product_connection_score, user_fit_score,
  score_reason, recommended_format, recommended_free_or_paid, status,
  confidence_score, evidence_count, source_count, freshness_score, duplicate_score, most_similar_idea_id
) values
('20000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005',
 '50代。会社がなくなったら、自分には何が残るんだろう。', 'AIによる仕事代替への不安を起点に、会社依存からの脱却を考えるテーマ',
 'ChatGPTに自分の仕事を要約させたら5秒で終わった。', '会社の看板を外した自分の価値を見つめ直す',
 '大手メーカー勤務、52歳、経理部門。転職経験なし。', '会社という後ろ盾を失った時に自分に何が残るか分からない恐怖',
 array['Ambition','Money'],
 15, 14, 13, 8, 9, 9, 9, 8, 5,
 '[{"criterion":"demand","score":15,"reason":"同世代の強い共感反応が多数観測される","evidence":"Research#5のSNS投稿への反応"},{"criterion":"pain","score":14,"reason":"アイデンティティの喪失に直結する深い悩み","evidence":"Research#5の投稿文"},{"criterion":"willingness_to_pay","score":13,"reason":"具体的な行動指針への支払意欲が見込める","evidence":"同種の悩み相談の有料化事例"},{"criterion":"competition_opportunity","score":8,"reason":"AI不安×会社依存の掛け合わせは競合が少ない","evidence":"検索結果の薄さ"},{"criterion":"trend","score":9,"reason":"生成AI導入のニュースが継続している","evidence":"Research#4"},{"criterion":"threads_virality","score":9,"reason":"共感型の投稿として拡散されやすい構成","evidence":"類似投稿のエンゲージメント"},{"criterion":"note_fit","score":9,"reason":"長文で深掘りできるテーマ性","evidence":"読者ペルソナの検索行動"},{"criterion":"product_connection","score":8,"reason":"診断コンテンツ化しやすい","evidence":"類似テーマの商品化事例"},{"criterion":"user_fit","score":5,"reason":"ブランド思想と完全に一致","evidence":"中心思想との整合"}]'::jsonb,
 'BOTH', 'PAID', 'PRIORITY', 87, 2, 2, 92, 0.12, null),

('20000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
 '早期退職の面談通知が来た日、妻に何と言おうか迷った。', '早期退職募集を起点に、会社依存からの脱却を家族目線で描くテーマ',
 '早期退職の対象になった。家族にどう説明するか。', '本人ではなく家族への説明という切り口で当事者性を高める',
 '大手メーカー勤務、54歳、既婚、子供は独立済み。', '会社への依存に気づきながらも家族への説明義務を感じている',
 array['Ambition','Money'],
 14, 15, 12, 9, 8, 8, 9, 7, 5,
 '[{"criterion":"demand","score":14,"reason":"早期退職関連の共感コメントが多い","evidence":"Research#1"},{"criterion":"pain","score":15,"reason":"家族への説明責任という追加の悩みが重なる","evidence":"Research#1のコメント欄"},{"criterion":"willingness_to_pay","score":12,"reason":"家族向け説明テンプレート等の需要が見込める","evidence":"類似相談の有料相談事例"},{"criterion":"competition_opportunity","score":9,"reason":"家族目線の切り口は競合が少ない","evidence":"検索結果"},{"criterion":"trend","score":8,"reason":"早期退職募集のニュースが継続","evidence":"Research#1"},{"criterion":"threads_virality","score":8,"reason":"家族エピソードは共感されやすい","evidence":"類似投稿の反応"},{"criterion":"note_fit","score":9,"reason":"ストーリー仕立てでnote向き","evidence":"読者傾向"},{"criterion":"product_connection","score":7,"reason":"家族との対話ワークシート化が可能","evidence":"類似商品事例"},{"criterion":"user_fit","score":5,"reason":"ブランド思想と一致","evidence":"中心思想"}]'::jsonb,
 'NOTE_PAID', 'PAID', 'PRIORITY', 81, 1, 1, 88, 0.18, null),

('20000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007',
 '定年後の再雇用で給料は半分。でも、やることは同じだった。', '定年後の再雇用の理不尽さから自分の価値を再定義するテーマ',
 '給料は半分になったのに、仕事量は変わらなかった。', '理不尽さへの怒りを行動のエネルギーに転換する',
 '製造業勤務、59歳、定年目前。', '定年後の再雇用制度における評価と報酬の不一致への納得感のなさ',
 array['Money'],
 13, 13, 11, 7, 6, 7, 8, 6, 4,
 '[{"criterion":"demand","score":13,"reason":"再雇用制度への不満は一定数存在","evidence":"Research#7"},{"criterion":"pain","score":13,"reason":"経済的・尊厳的な二重の痛み","evidence":"Research#7の調査結果"},{"criterion":"willingness_to_pay","score":11,"reason":"再雇用交渉ノウハウへの需要は中程度","evidence":"類似相談件数"},{"criterion":"competition_opportunity","score":7,"reason":"労務系メディアとの競合がある","evidence":"検索結果"},{"criterion":"trend","score":6,"reason":"継続的だが急上昇ではない","evidence":"Research#7"},{"criterion":"threads_virality","score":7,"reason":"怒りベースの投稿は一定の拡散力","evidence":"類似投稿"},{"criterion":"note_fit","score":8,"reason":"制度解説と組み合わせやすい","evidence":"読者傾向"},{"criterion":"product_connection","score":6,"reason":"商品化の余地はあるが限定的","evidence":"類似事例の少なさ"},{"criterion":"user_fit","score":4,"reason":"ブランド思想とはやや距離がある","evidence":"中心思想との整合"}]'::jsonb,
 'NOTE_FREE', 'FREE', 'CANDIDATE', 74, 1, 1, 65, 0.09, null),

('20000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000009',
 '副業「何から始める」で1年間、何も始めなかった話。', '副業への一歩が踏み出せない50代の行動を後押しするテーマ',
 '調べるだけで1年が過ぎた。始められない理由は何だったのか。', '情報収集ループから抜け出す具体的な一歩を示す',
 'IT企業勤務、49歳、副業に興味はあるが未着手。', '副業を始めたいのに情報収集だけで行動に移せない',
 array['Money','Ambition'],
 12, 11, 10, 6, 8, 8, 8, 8, 5,
 '[{"criterion":"demand","score":12,"reason":"副業を始めたいという需要は非常に大きい","evidence":"Research#9"},{"criterion":"pain","score":11,"reason":"行動できないもどかしさは中程度の悩み","evidence":"Research#9のコメント"},{"criterion":"willingness_to_pay","score":10,"reason":"具体的な一歩を示すコンテンツへの支払意欲","evidence":"類似講座の販売実績"},{"criterion":"competition_opportunity","score":6,"reason":"副業系コンテンツは競合が非常に多い","evidence":"検索結果の多さ"},{"criterion":"trend","score":8,"reason":"副業解禁の流れが継続","evidence":"一般的なトレンド"},{"criterion":"threads_virality","score":8,"reason":"あるある系で共感されやすい","evidence":"類似投稿"},{"criterion":"note_fit","score":8,"reason":"ステップ形式で書きやすい","evidence":"読者傾向"},{"criterion":"product_connection","score":8,"reason":"副業スタートアップキットとして商品化しやすい","evidence":"類似商品事例"},{"criterion":"user_fit","score":5,"reason":"ブランド思想と一致","evidence":"中心思想"}]'::jsonb,
 'BOTH', 'EITHER', 'CANDIDATE', 69, 1, 1, 90, 0.31, null),

('20000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000012',
 '50代の転職成功率は20代の1/5。それでも動くべき理由。', '転職市場の厳しい現実を直視した上で行動を促すテーマ',
 '50代の転職成功率は20代の1/5というデータを見て、それでも動いた人の話。', 'データの厳しさと行動の価値を対比させる',
 '営業職、51歳、転職を検討中。', '転職市場での自分の価値が分からず動けない',
 array['Ambition','Money'],
 11, 12, 10, 7, 7, 6, 7, 6, 4,
 '[{"criterion":"demand","score":11,"reason":"転職検討層は一定数存在","evidence":"Research#12"},{"criterion":"pain","score":12,"reason":"市場価値への不安は根深い","evidence":"Research#12のデータ"},{"criterion":"willingness_to_pay","score":10,"reason":"転職エージェント以外の情報への支払意欲は中程度","evidence":"類似コンテンツ販売実績"},{"criterion":"competition_opportunity","score":7,"reason":"転職メディアとの競合がある","evidence":"検索結果"},{"criterion":"trend","score":7,"reason":"継続的な検索需要","evidence":"Research#12"},{"criterion":"threads_virality","score":6,"reason":"データ引用型でやや拡散力は控えめ","evidence":"類似投稿"},{"criterion":"note_fit","score":7,"reason":"データ解説と相性が良い","evidence":"読者傾向"},{"criterion":"product_connection","score":6,"reason":"商品化の余地は限定的","evidence":"類似事例"},{"criterion":"user_fit","score":4,"reason":"ブランド思想とはやや距離がある","evidence":"中心思想との整合"}]'::jsonb,
 'NOTE_FREE', 'FREE', 'CANDIDATE', 71, 1, 1, 80, 0.07, null),

('20000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000016',
 '老後資金2000万円問題、50代の私が今からできること3つ', '老後資金不安に対して50代から今できる具体策を示すテーマ',
 '2000万円問題を見て見ぬふりをしてきた50代へ。', '不安を煽らず、今日からできる行動に落とし込む',
 '会社員、53歳、資産形成は未着手。', '老後資金への漠然とした不安があるが何もしていない',
 array['Money'],
 10, 10, 12, 5, 6, 5, 7, 9, 4,
 '[{"criterion":"demand","score":10,"reason":"老後資金への関心は根強い","evidence":"Research#16"},{"criterion":"pain","score":10,"reason":"漠然とした不安であり緊急性はやや低い","evidence":"Research#16"},{"criterion":"willingness_to_pay","score":12,"reason":"資産形成系コンテンツは支払意欲が高い","evidence":"新NISA関連商品の販売実績"},{"criterion":"competition_opportunity","score":5,"reason":"金融系メディアとの競合が非常に多い","evidence":"検索結果の多さ"},{"criterion":"trend","score":6,"reason":"継続的だが目新しさは薄い","evidence":"Research#16"},{"criterion":"threads_virality","score":5,"reason":"金融系は拡散力が控えめ","evidence":"類似投稿"},{"criterion":"note_fit","score":7,"reason":"具体策の解説と相性が良い","evidence":"読者傾向"},{"criterion":"product_connection","score":9,"reason":"資産形成診断ツールとして商品化しやすい","evidence":"類似商品事例"},{"criterion":"user_fit","score":4,"reason":"ブランド思想とはやや距離がある","evidence":"中心思想との整合"}]'::jsonb,
 'NOTE_PAID', 'PAID', 'HOLD', 58, 1, 1, 60, 0.05, null),

('20000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000018',
 '人生100年時代。50代はまだ折り返し地点にすぎない。', '人生の残り時間を前向きに捉え直す人生再設計テーマ',
 '人生100年なら、50代はまだ折り返し。', '「まだ間に合う」というポジティブな切り口',
 '会社員、50歳、漠然とした将来不安を抱える。', '残りの人生をどう生きるか分からない漠然とした焦り',
 array['Ambition','Health'],
 9, 9, 8, 6, 7, 8, 7, 5, 5,
 '[{"criterion":"demand","score":9,"reason":"人生100年時代の話題は一定の関心を集める","evidence":"Research#18"},{"criterion":"pain","score":9,"reason":"漠然とした悩みであり深さは中程度","evidence":"Research#18"},{"criterion":"willingness_to_pay","score":8,"reason":"抽象的なテーマは支払意欲がやや弱い","evidence":"類似コンテンツの販売実績の少なさ"},{"criterion":"competition_opportunity","score":6,"reason":"自己啓発系との競合がある","evidence":"検索結果"},{"criterion":"trend","score":7,"reason":"継続的な話題性","evidence":"Research#18"},{"criterion":"threads_virality","score":8,"reason":"前向きなメッセージは拡散されやすい","evidence":"類似投稿の反応"},{"criterion":"note_fit","score":7,"reason":"エッセイ調で書きやすい","evidence":"読者傾向"},{"criterion":"product_connection","score":5,"reason":"商品化の具体像が弱い","evidence":"類似事例の少なさ"},{"criterion":"user_fit","score":5,"reason":"中心思想と一致","evidence":"ブランドメッセージとの整合"}]'::jsonb,
 'THREADS', 'FREE', 'HOLD', 55, 1, 1, 78, 0.15, null),

('20000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', null,
 '50代からのAIリスキリング、何から手をつければいいか', 'AIスキル習得への一歩を後押しするテーマ(手動登録・根拠不足のサンプル)',
 null, null, null, null,
 array['Ambition']::text[],
 8, 7, 7, 6, 8, 6, 6, 6, 4,
 '[{"criterion":"demand","score":8,"reason":"AIスキル需要は高いが根拠となる一次情報が手薄","evidence":"手動登録のため一般的な認識に基づく"},{"criterion":"pain","score":7,"reason":"悩みの深さは推測の域を出ない","evidence":"根拠Researchなし"},{"criterion":"willingness_to_pay","score":7,"reason":"AI講座市場は一定の支払意欲が見込める","evidence":"一般的な市場動向"},{"criterion":"competition_opportunity","score":6,"reason":"AI系コンテンツは競合が多い","evidence":"検索結果の一般的傾向"},{"criterion":"trend","score":8,"reason":"生成AI全般のトレンドは強い","evidence":"一般的なニュース動向"},{"criterion":"threads_virality","score":6,"reason":"ノウハウ系は中程度の拡散力","evidence":"類似投稿の一般傾向"},{"criterion":"note_fit","score":6,"reason":"ハウツー記事として書きやすい","evidence":"一般的な記事傾向"},{"criterion":"product_connection","score":6,"reason":"講座化の余地はある","evidence":"一般的な商品傾向"},{"criterion":"user_fit","score":4,"reason":"ブランド思想とはやや距離がある","evidence":"中心思想との整合"}]'::jsonb,
 'NOTE_FREE', 'FREE', 'HOLD', 24, 0, 0, 0, null, null),

('20000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003',
 '会社を辞めたい。でも怖い。その「怖さ」の正体を分解する', '会社を辞める決断ができない心理を分解するテーマ',
 '辞めたいのに辞められない。その怖さは何でできているのか。', '感情を要素分解して行動可能な単位に変える',
 '会社員、50代前半、転職未経験。', '会社を辞める決断ができない漠然とした恐怖',
 array['Ambition'],
 9, 10, 8, 7, 5, 7, 8, 6, 5,
 '[{"criterion":"demand","score":9,"reason":"「辞めたいが怖い」の検索需要は一定数存在","evidence":"Research#3"},{"criterion":"pain","score":10,"reason":"意思決定できない苦しさは深い","evidence":"Research#3の相談内容"},{"criterion":"willingness_to_pay","score":8,"reason":"自己理解系コンテンツへの支払意欲は中程度","evidence":"類似コンテンツ事例"},{"criterion":"competition_opportunity","score":7,"reason":"心理分解系の切り口は競合が少ない","evidence":"検索結果"},{"criterion":"trend","score":5,"reason":"突発的な急上昇はない","evidence":"Research#3"},{"criterion":"threads_virality","score":7,"reason":"内省的な投稿は共感を呼びやすい","evidence":"類似投稿"},{"criterion":"note_fit","score":8,"reason":"じっくり深掘りできるテーマ","evidence":"読者傾向"},{"criterion":"product_connection","score":6,"reason":"診断コンテンツ化の余地がある","evidence":"類似事例"},{"criterion":"user_fit","score":5,"reason":"ブランド思想と一致","evidence":"中心思想"}]'::jsonb,
 'NOTE_FREE', 'FREE', 'REJECTED', 62, 1, 1, 55, 0.42, '20000000-0000-0000-0000-000000000001'),

('20000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000014',
 '社外に出た瞬間、「ただの人」になった先輩を見て考えたこと', '肩書き喪失後の自己価値をテーマにしたコンテンツ',
 '名刺を失った瞬間、その人には何が残るのか。', '第三者(先輩)の観察を通じて自分事化させる',
 '会社員、52歳、管理職。', '社外での自分の市場価値を客観視できていない',
 array['Ambition'],
 13, 12, 11, 8, 7, 8, 8, 7, 5,
 '[{"criterion":"demand","score":13,"reason":"市場価値の棚卸しへの関心は高い","evidence":"Research#14"},{"criterion":"pain","score":12,"reason":"肩書き喪失への恐怖は根深い","evidence":"Research#14の投稿内容"},{"criterion":"willingness_to_pay","score":11,"reason":"キャリア棚卸しワークへの支払意欲がある","evidence":"類似ワークショップの実績"},{"criterion":"competition_opportunity","score":8,"reason":"具体的な観察エピソード切り口は競合が少ない","evidence":"検索結果"},{"criterion":"trend","score":7,"reason":"継続的な関心テーマ","evidence":"Research#14"},{"criterion":"threads_virality","score":8,"reason":"ストーリー性が高く拡散されやすい","evidence":"類似投稿の反応"},{"criterion":"note_fit","score":8,"reason":"人物描写を交えて書きやすい","evidence":"読者傾向"},{"criterion":"product_connection","score":7,"reason":"棚卸しワークシート化が可能","evidence":"類似商品事例"},{"criterion":"user_fit","score":5,"reason":"ブランド思想と一致","evidence":"中心思想"}]'::jsonb,
 'BOTH', 'PAID', 'PRIORITY', 83, 1, 1, 85, 0.21, null),

('20000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000019',
 '会社員のまま、こっそり「第二の人生」の助走をつけた人の話', '会社員を続けながら次のキャリアを準備するテーマ',
 '辞めずに、こっそり準備するという選択肢。', '「辞める/辞めない」の二択から抜け出す',
 '会社員、54歳、退職予定なし。', '会社員以外の自分を想像できない',
 array['Ambition'],
 12, 10, 10, 7, 6, 7, 8, 7, 5,
 '[{"criterion":"demand","score":12,"reason":"辞めずに準備したい層は一定数存在","evidence":"Research#19"},{"criterion":"pain","score":10,"reason":"悩みの深さは中程度","evidence":"Research#19のブログ内容"},{"criterion":"willingness_to_pay","score":10,"reason":"準備ノウハウへの支払意欲は中程度","evidence":"類似コンテンツ事例"},{"criterion":"competition_opportunity","score":7,"reason":"「辞めない」切り口は競合が少ない","evidence":"検索結果"},{"criterion":"trend","score":6,"reason":"継続的だが急伸はない","evidence":"Research#19"},{"criterion":"threads_virality","score":7,"reason":"実例ベースで共感を呼びやすい","evidence":"類似投稿"},{"criterion":"note_fit","score":8,"reason":"ステップ形式で書きやすい","evidence":"読者傾向"},{"criterion":"product_connection","score":7,"reason":"準備ロードマップとして商品化しやすい","evidence":"類似事例"},{"criterion":"user_fit","score":5,"reason":"ブランド思想と完全に一致","evidence":"中心思想そのもの"}]'::jsonb,
 'NOTE_PAID', 'PAID', 'CANDIDATE', 76, 1, 1, 68, 0.11, null),

('20000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000008',
 '定年後、何もすることがない。その空白と向き合う3ヶ月', '定年後の喪失感と向き合うテーマ',
 '肩書きを失った後の「何もない毎日」をどう過ごすか。', '喪失を否定せず、向き合うプロセスとして描く',
 '定年退職者、61歳。', '定年後の時間とアイデンティティの喪失',
 array['Health','Ambition'],
 7, 9, 6, 5, 4, 5, 7, 4, 4,
 '[{"criterion":"demand","score":7,"reason":"定年退職者向けの需要は会社員向けより小さい","evidence":"Research#8"},{"criterion":"pain","score":9,"reason":"アイデンティティ喪失は深刻な悩み","evidence":"Research#8の相談内容"},{"criterion":"willingness_to_pay","score":6,"reason":"退職済み層は新規支出への意欲が低め","evidence":"一般的傾向"},{"criterion":"competition_opportunity","score":5,"reason":"シニア向けメディアとの競合がある","evidence":"検索結果"},{"criterion":"trend","score":4,"reason":"急上昇のトレンドではない","evidence":"Research#8"},{"criterion":"threads_virality","score":5,"reason":"当事者層のThreads利用率が低い","evidence":"一般的な利用傾向"},{"criterion":"note_fit","score":7,"reason":"エッセイとして書きやすい","evidence":"読者傾向"},{"criterion":"product_connection","score":4,"reason":"商品化の具体像が弱い","evidence":"類似事例の少なさ"},{"criterion":"user_fit","score":4,"reason":"メインターゲット(現役会社員)からはやや外れる","evidence":"ターゲット定義との整合"}]'::jsonb,
 'NOTE_FREE', 'FREE', 'HOLD', 48, 1, 1, 50, 0.06, null),

('20000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000010',
 '副業の情報商材で30万円溶かした50代が、次に選んだ道', '副業詐欺被害からの再起をテーマにした失敗談型コンテンツ',
 '30万円の授業料を払って学んだこと。', '失敗を成功のプロセスとして再構築する',
 '会社員、51歳、副業詐欺被害経験あり。', '副業への不信感と再挑戦への恐怖',
 array['Money'],
 8, 11, 9, 6, 5, 7, 7, 5, 4,
 '[{"criterion":"demand","score":8,"reason":"副業詐欺の体験談は一定の関心を集める","evidence":"Research#10"},{"criterion":"pain","score":11,"reason":"金銭的損失と自己嫌悪の二重の痛み","evidence":"Research#10のブログ内容"},{"criterion":"willingness_to_pay","score":9,"reason":"再挑戦を後押しするコンテンツへの意欲は中程度","evidence":"類似コンテンツ事例"},{"criterion":"competition_opportunity","score":6,"reason":"失敗談系は一定数存在する","evidence":"検索結果"},{"criterion":"trend","score":5,"reason":"継続的だが急伸はない","evidence":"Research#10"},{"criterion":"threads_virality","score":7,"reason":"失敗談は共感と拡散を呼びやすい","evidence":"類似投稿"},{"criterion":"note_fit","score":7,"reason":"ストーリーとして書きやすい","evidence":"読者傾向"},{"criterion":"product_connection","score":5,"reason":"商品化はやや慎重を要する(信頼回復が前提)","evidence":"類似事例の少なさ"},{"criterion":"user_fit","score":4,"reason":"ブランド思想とは部分的に一致","evidence":"中心思想との整合"}]'::jsonb,
 'THREADS', 'FREE', 'CANDIDATE', 70, 1, 1, 45, 0.08, null),

('20000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', null,
 '50代からの新NISA、今さら聞けない基本のキ', '新NISAをテーマにした一般的な解説コンテンツ(低優先サンプル)',
 null, null, null, null,
 array['Money']::text[],
 5, 4, 6, 3, 5, 3, 5, 5, 3,
 '[{"criterion":"demand","score":5,"reason":"一般的な解説記事は既に飽和している","evidence":"手動登録・一般的な市場認識"},{"criterion":"pain","score":4,"reason":"悩みというより情報不足に近い","evidence":"根拠Researchなし"},{"criterion":"willingness_to_pay","score":6,"reason":"無料情報が豊富で支払意欲は低め","evidence":"一般的な市場動向"},{"criterion":"competition_opportunity","score":3,"reason":"金融系の競合が非常に多い","evidence":"検索結果の一般的傾向"},{"criterion":"trend","score":5,"reason":"目新しさに欠ける","evidence":"一般的な認識"},{"criterion":"threads_virality","score":3,"reason":"一般的な解説は拡散されにくい","evidence":"類似投稿の一般傾向"},{"criterion":"note_fit","score":5,"reason":"解説記事として書きやすいが差別化しにくい","evidence":"一般的な記事傾向"},{"criterion":"product_connection","score":5,"reason":"商品化の独自性が弱い","evidence":"一般的な商品傾向"},{"criterion":"user_fit","score":3,"reason":"ブランドの中心思想からは外れ気味","evidence":"中心思想との整合"}]'::jsonb,
 'NOTE_FREE', 'FREE', 'REJECTED', 22, 0, 0, 0, null, null),

('20000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', null,
 '50代、転職エージェントに登録だけして半年放置した話', 'まだAI採点を実行していない、未評価のIdeaサンプル',
 null, null, null, null,
 array[]::text[],
 null, null, null, null, null, null, null, null, null,
 '[]'::jsonb,
 null, null, 'NEW', null, 0, 0, null, null, null)
on conflict (id) do nothing;

-- ============================================================
-- Idea Sources(Evidence): 生成元Researchとの対応関係
-- ============================================================
insert into public.gos_idea_sources (id, user_id, idea_id, research_item_id, evidence) values
('30000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'ChatGPTに自分の業務を要約させたら5秒で終わったという投稿が強い共感を集めている'),
('30000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', '大手企業が生成AI導入で事務職を段階的に削減する方針を発表'),
('30000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '早期退職募集のニュースに「会社に人生を預けていた」という共感コメントが多数'),
('30000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000007', '定年後の再雇用で給与が半減する制度の実態調査'),
('30000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000009', '副業を始めたいが何をすればいいか分からないという投稿への反応'),
('30000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000012', '50代の転職成功率は20代の1/5というデータ'),
('30000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000016', '老後資金2000万円問題が再燃し関心が高まっている'),
('30000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000018', '人生100年時代、50代はまだ折り返し地点という投稿への共感'),
('30000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000003', '「会社を辞めたいが怖い」という相談投稿'),
('30000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000014', '50代でキャリアの棚卸しをした投稿が話題'),
('30000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000019', '会社員を続けながら第二の人生を準備した人のブログ'),
('30000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000008', '定年退職者が「何もすることがなく不安」と相談'),
('30000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000010', '副業の情報商材で失敗した50代のブログ記事')
on conflict (idea_id, research_item_id) do nothing;

-- ============================================================
-- AI Reviews(サンプル。監査証跡の見え方を確認できる程度)
-- ============================================================
insert into public.gos_ai_reviews (user_id, target_type, target_id, agent_type, score, feedback, raw_response) values
('a0000000-0000-0000-0000-000000000001', 'RESEARCH_ITEM', '10000000-0000-0000-0000-000000000005', 'RESEARCH_CLASSIFIER', null,
 'ChatGPTによる業務代替の実体験は、AI失業不安の中でも特に「自分の仕事が本当に代替可能だ」という具体的な恐怖を喚起する強い事例。',
 '{"harm_types":["Ambition"],"trend_score":91,"pain_score":85}'::jsonb),
('a0000000-0000-0000-0000-000000000001', 'IDEA', '20000000-0000-0000-0000-000000000001', 'IDEA_GENERATOR', null,
 '2件のResearchから生成', '{"title":"50代。会社がなくなったら、自分には何が残るんだろう。"}'::jsonb),
('a0000000-0000-0000-0000-000000000001', 'IDEA', '20000000-0000-0000-0000-000000000001', 'IDEA_SCORER', 87,
 '信頼度87%(有力候補)。根拠件数2件、出典2種類。', '[]'::jsonb);

-- ============================================================
-- AI Jobs(Settings画面の「今月のAI使用量」表示を確認できるダミー履歴)
-- ============================================================
insert into public.gos_ai_jobs (user_id, job_type, target_type, target_id, status, model, input_tokens, output_tokens, estimated_cost, started_at, completed_at) values
('a0000000-0000-0000-0000-000000000001', 'RESEARCH_CLASSIFY', 'RESEARCH_ITEM', '10000000-0000-0000-0000-000000000005', 'SUCCEEDED', 'claude-sonnet-5', 1200, 350, 0.00590, now() - interval '1 day', now() - interval '1 day'),
('a0000000-0000-0000-0000-000000000001', 'IDEA_GENERATE', 'RESEARCH_ITEM_SET', '10000000-0000-0000-0000-000000000005', 'SUCCEEDED', 'claude-sonnet-5', 2400, 900, 0.01380, now() - interval '1 day', now() - interval '1 day'),
('a0000000-0000-0000-0000-000000000001', 'IDEA_SCORE', 'IDEA', '20000000-0000-0000-0000-000000000001', 'SUCCEEDED', 'claude-sonnet-5', 1800, 700, 0.01060, now() - interval '1 day', now() - interval '1 day');

-- ============================================================
-- フェーズ3デモウォークスルー(セクション31):
-- 「50代。会社がなくなったら、あなたには何が残りますか？」というAPPROVED Ideaを、
-- Content Strategy → Threads 5案 → 無料noteのOutline/Draft → AI Review → Fact Check まで
-- 実際に流した状態を再現する。架空の体験は一切生成せず、一人称の体験談は
-- Experience Libraryに登録済みの実体験(VERIFIED_BY_USER)だけを使う。
-- ============================================================

insert into public.gos_content_ideas (
  id, user_id, research_item_id, title, summary, hook, angle, target_persona, core_problem, harm_types,
  demand_score, pain_score, willingness_to_pay_score, competition_opportunity_score, trend_score,
  threads_virality_score, note_fit_score, product_connection_score, user_fit_score,
  score_reason, recommended_format, recommended_free_or_paid, status,
  confidence_score, evidence_count, source_count, freshness_score, duplicate_score, most_similar_idea_id
) values
('21000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005',
 '50代。会社がなくなったら、あなたには何が残りますか？', 'AIによる業務代替と会社依存の不安を起点に、読者自身に問いかける形のテーマ',
 'ChatGPTに自分の仕事を要約させたら5秒で終わった。', '「あなたには」という二人称で読者自身に当事者性を持たせる',
 '大手企業勤務、45〜59歳、会社員。転職経験の有無を問わない。', '会社という看板がなくなった時、自分自身に市場価値があるのかわからない',
 array['Ambition','Money'],
 14, 15, 13, 9, 10, 9, 9, 9, 5,
 '[{"criterion":"demand","score":14,"reason":"「会社がなくなったら」という問いは45〜59歳の会社員に広く刺さる","evidence":"Research#4,#5"},{"criterion":"pain","score":15,"reason":"市場価値の不確かさは自己肯定感に直結する深い悩み","evidence":"Research#5の投稿への共感反応"},{"criterion":"willingness_to_pay","score":13,"reason":"自己の棚卸しを支援するワーク形式への支払意欲が見込める","evidence":"類似の自己分析コンテンツの販売実績"},{"criterion":"competition_opportunity","score":9,"reason":"「あなたには」と二人称で問いかける切り口は競合が少ない","evidence":"検索結果の薄さ"},{"criterion":"trend","score":10,"reason":"生成AI導入のニュースが継続的に報じられている","evidence":"Research#4"},{"criterion":"threads_virality","score":9,"reason":"問いかけ型は保存・引用されやすい","evidence":"類似投稿のエンゲージメント傾向"},{"criterion":"note_fit","score":9,"reason":"ワーク形式へ展開しやすく長文向き","evidence":"読者の検索行動"},{"criterion":"product_connection","score":9,"reason":"棚卸しワークとして有料商品に直結しやすい","evidence":"類似ワークショップの実績"},{"criterion":"user_fit","score":5,"reason":"ブランドの中心思想と完全に一致","evidence":"「会社がなくても生きられる自分」というテーマそのもの"}]'::jsonb,
 'BOTH', 'PAID', 'APPROVED', 90, 2, 2, 91, 0.15, null)
on conflict (id) do nothing;

insert into public.gos_idea_sources (id, user_id, idea_id, research_item_id, evidence) values
('30000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', '大手企業が生成AI導入により今後3年で事務職を3割削減する方針を発表'),
('30000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'ChatGPTに自分の業務を要約させたら5秒で終わったという投稿が強い共感を集めている')
on conflict (idea_id, research_item_id) do nothing;

-- Content Strategy: 「読者をどう動かすか」を定義する
insert into public.gos_content_strategies (
  id, user_id, idea_id, target_reader, reader_situation, surface_problem, deep_problem, desired_emotion,
  desired_action, main_message, unique_angle, content_goal, free_or_paid, cta_strategy,
  threads_role, free_note_role, paid_note_role
) values
('61000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
 '45〜59歳、大手・中堅企業に勤める会社員。転職や独立はまだ考えていない。',
 '会社の看板があるうちは気づかないが、AI導入のニュースを見るたび「自分は大丈夫か」という不安がよぎっている状態',
 '生成AIに自分の仕事が代替されるのではという漠然とした不安',
 '会社という看板を外した時、自分自身に市場価値があるのかどうかがわからないという本質的な恐怖',
 '不安ではなく、落ち着いた当事者意識(「気づけてよかった」という納得感)',
 'まず自分がこれまで積み上げてきた経験を棚卸ししてみる',
 '会社を辞める必要はない。ただ、会社がなくても生きられる自分を今のうちに作っておこう',
 '「転職しよう」ではなく「棚卸ししよう」という、辞める/辞めないの二択から外れた提案',
 '読者に「棚卸し」という具体的で低リスクな最初の一歩を踏み出してもらう',
 'BOTH', 'Threadsで気づきを与え、無料noteで棚卸しの視点を示し、有料note/ワークで実際に手を動かしてもらう',
 '「あなたには」と二人称で問いかけ、自分ごと化のきっかけを作る',
 '棚卸しの視点(何を・なぜ棚卸しすべきか)を示し、思考の整理を後押しする',
 '実際に棚卸しをやり切るための具体的なワークシートと手順を提供する')
on conflict (idea_id) do nothing;

-- Threads 5パターン(セクション3): FAILURE(体験・ストーリー型)は登録済み体験が無い前提で
-- 一般論として書き、一人称の体験を捏造していない(experience_idsは空)。
insert into public.gos_threads_posts (
  id, user_id, idea_id, strategy_id, pattern_type, body,
  hook_score, empathy_score, humanity_score, clarity_score, shareability_score,
  sales_smell_score, ai_smell_score, preachiness_score, fear_score, overall_score,
  score_reason, rewrite_count, manual_edited, experience_ids, status
) values
('62000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
 'EMPATHY',
 'ChatGPTに自分の仕事を要約させたら、5秒で終わった。' || chr(10) || chr(10) ||
 '笑うしかなかった。20年かけて覚えたことが、たった5秒。' || chr(10) || chr(10) ||
 '同じような経験、ありませんか。会社の看板の下でやってきたことが、看板を外した瞬間にどれだけ残るのか。考えたことがない人の方が多いはずです。',
 88, 86, 82, 90, 84, 8, 12, 15, 30, 84,
 '[{"criterion":"hook","score":88,"reason":"「5秒で終わった」という具体的な数字が冒頭で興味を引く"},{"criterion":"empathy","score":86,"reason":"同世代の会社員が共感しやすい体験を起点にしている"},{"criterion":"humanity","score":82,"reason":"「笑うしかなかった」という率直な感情表現がある"},{"criterion":"clarity","score":90,"reason":"短文・改行が多く読みやすい"},{"criterion":"shareability","score":84,"reason":"問いかけで終わるため引用・保存されやすい"},{"criterion":"sales_smell","score":8,"reason":"売り込み要素が無い"},{"criterion":"ai_smell","score":12,"reason":"定型的な三段構成になっていない"},{"criterion":"preachiness","score":15,"reason":"説教口調ではない"},{"criterion":"fear","score":30,"reason":"不安を煽りすぎず問いかけに留めている"}]'::jsonb,
 0, false, '{}', 'WAITING_APPROVAL'),

('62000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
 'PROBLEM',
 '生成AIの導入で事務職を段階的に削減する。そんなニュースを、他人事として読んでいませんか。' || chr(10) || chr(10) ||
 '「自分の会社はまだ大丈夫」ではなく、「自分の仕事の中身」を見たとき、AIに置き換えられる部分がどれくらいあるか。一度、棚卸ししてみる価値はあります。',
 80, 75, 70, 88, 78, 10, 10, 20, 42, 79,
 '[{"criterion":"hook","score":80,"reason":"ニュースを引用しつつ自分事化を促す問いかけがある"},{"criterion":"empathy","score":75,"reason":"「他人事として読んでいませんか」という指摘が刺さる"},{"criterion":"humanity","score":70,"reason":"やや解説寄りで感情の起伏は控えめ"},{"criterion":"clarity","score":88,"reason":"構成がシンプルで理解しやすい"},{"criterion":"shareability","score":78,"reason":"問題提起として拡散されやすい"},{"criterion":"sales_smell","score":10,"reason":"商品誘導が無い"},{"criterion":"ai_smell","score":10,"reason":"自然な問いかけで終わっている"},{"criterion":"preachiness","score":20,"reason":"軽度の説教感はあるが許容範囲"},{"criterion":"fear","score":42,"reason":"不安要素はあるが行動提案で締めている"}]'::jsonb,
 0, false, '{}', 'WAITING_APPROVAL'),

('62000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
 'FAILURE',
 '一般的なケースでは、と前置きします。私自身の体験ではなく、周囲でよく聞く話としてです。' || chr(10) || chr(10) ||
 '「会社の看板を外した自分に自信が持てない」という悩みは、50代の会社員から驚くほどよく聞きます。' || chr(10) || chr(10) ||
 'もしあなたにも近い経験があれば、それこそが「棚卸し」の最初の材料になるはずです。',
 62, 68, 55, 80, 60, 12, 18, 25, 35, 66,
 '[{"criterion":"hook","score":62,"reason":"一般論からの入りのため引きはやや弱い"},{"criterion":"empathy","score":68,"reason":"「よく聞く話」として共感の輪を示している"},{"criterion":"humanity","score":55,"reason":"一人称の実体験を使っていないため人間味はやや控えめ"},{"criterion":"clarity","score":80,"reason":"構成は明快"},{"criterion":"shareability","score":60,"reason":"具体性がやや弱く拡散力は中程度"},{"criterion":"sales_smell","score":12,"reason":"売り込み要素は無い"},{"criterion":"ai_smell","score":18,"reason":"前置きがやや説明的"},{"criterion":"preachiness","score":25,"reason":"軽度の説教感がある"},{"criterion":"fear","score":35,"reason":"不安喚起は控えめ"}]'::jsonb,
 0, false, '{}', 'WAITING_APPROVAL'),

('62000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
 'QUESTION',
 '会社の名刺を渡さずに自己紹介するとしたら、あなたは何と言いますか。' || chr(10) || chr(10) ||
 '肩書きでも、部署でもなく。「自分は何ができる人間か」だけで語るとしたら。' || chr(10) || chr(10) ||
 '意外と、言葉に詰まる人が多いテーマです。',
 90, 82, 78, 92, 88, 6, 10, 10, 28, 88,
 '[{"criterion":"hook","score":90,"reason":"具体的な行動を想像させる問いかけが強い"},{"criterion":"empathy","score":82,"reason":"多くの会社員が一度は考える問いである"},{"criterion":"humanity","score":78,"reason":"問いかけ自体が内省的で人間味がある"},{"criterion":"clarity","score":92,"reason":"短く明快"},{"criterion":"shareability","score":88,"reason":"自分ごと化しやすく引用されやすい"},{"criterion":"sales_smell","score":6,"reason":"売り込み要素が無い"},{"criterion":"ai_smell","score":10,"reason":"自然な問いかけ調"},{"criterion":"preachiness","score":10,"reason":"説教臭が無い"},{"criterion":"fear","score":28,"reason":"不安よりも内省を促す設計"}]'::jsonb,
 0, false, '{}', 'WAITING_APPROVAL'),

('62000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
 'CONTRARIAN',
 '「会社に依存しない自分を作ろう」と聞くと、辞める準備だと思われがちです。' || chr(10) || chr(10) ||
 '逆です。むしろ、辞めなくていいと思えるようになるための準備です。' || chr(10) || chr(10) ||
 '会社を辞めないまま、会社がなくても大丈夫な自分を先に作っておく。順番を変えるだけの話です。',
 84, 78, 74, 86, 82, 9, 11, 12, 25, 82,
 '[{"criterion":"hook","score":84,"reason":"一般的な思い込みを反転させる導入が興味を引く"},{"criterion":"empathy","score":78,"reason":"「辞める前提」への誤解を代弁している"},{"criterion":"humanity","score":74,"reason":"順番を変えるという柔らかい提案に人間味がある"},{"criterion":"clarity","score":86,"reason":"逆説の構造が明快"},{"criterion":"shareability","score":82,"reason":"意外性があり引用されやすい"},{"criterion":"sales_smell","score":9,"reason":"売り込み要素が無い"},{"criterion":"ai_smell","score":11,"reason":"自然な逆説表現"},{"criterion":"preachiness","score":12,"reason":"説教臭が薄い"},{"criterion":"fear","score":25,"reason":"不安ではなく安心を提示する設計"}]'::jsonb,
 0, false, '{}', 'WAITING_APPROVAL')
on conflict (id) do nothing;

-- Experience Library: AIが一人称の体験談を書く際に使ってよい、本人の実体験
insert into public.gos_experience_library (id, user_id, title, summary, tags, confidence) values
('68000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
 '経理から社内DX推進チームへ異動し、AIツール導入を担当した経験',
 '経理部門で10年以上請求書処理を担当していたが、社内DX推進チームへ異動し、生成AIを使った業務効率化ツールの導入を担当することになった。最初は自分の仕事がAIに奪われる側だと思っていたが、実際にはAIを使いこなす側に回れることに気づいた。',
 array['AI','社内異動','経理'], 'VERIFIED_BY_USER'),
('68000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
 '40代で転職活動をして、書類選考でなかなか通らなかった経験',
 '40代半ばで一度だけ転職活動をしたことがある。職務経歴書の書き方が分からず、最初の10社はすべて書類選考で落ちた。転職エージェントに経歴の棚卸しを手伝ってもらってから通過率が上がった。',
 array['転職','棚卸し'], 'VERIFIED_BY_USER'),
('68000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001',
 '副業でライティングを始めたが、3ヶ月で辞めてしまった経験',
 '副業でクラウドソーシングのライティング案件を始めたが、単価が低く続かなかった。詳細を思い出しきれておらず、本人確認が必要。',
 array['副業'], 'NEEDS_REVIEW')
on conflict (id) do nothing;

-- Writing Profile: Threads/note生成時に参照する文体設定
insert into public.gos_writing_profiles (
  id, user_id, preferred_tone, sentence_length, humor_level, directness, emotional_level,
  technical_level, emoji_level, line_break_style, ng_phrases, preferred_phrases
) values
('69000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
 '落ち着いていて、断定しすぎない。読者に語りかけるような口調', 'MEDIUM', 15, 55, 65, 25, 0, 'MODERATE',
 array['結論から言うと','〜なのです','重要なのは'],
 array['〜かもしれません','一緒に考えてみませんか','同じような経験はありませんか'])
on conflict (user_id) do nothing;

insert into public.gos_writing_samples (id, user_id, source_type, source_id, excerpt) values
('6a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'THREADS_POST', '62000000-0000-0000-0000-000000000004',
 '会社の名刺を渡さずに自己紹介するとしたら、あなたは何と言いますか。肩書きでも、部署でもなく。「自分は何ができる人間か」だけで語るとしたら。')
on conflict (id) do nothing;

-- note(無料): Outline承認済み・本文Draft済み・AI Review/Fact Check完了・WAITING_APPROVAL
insert into public.gos_note_articles (
  id, user_id, idea_id, strategy_id, type, price, title, title_candidates, lead, reader_problem, promise,
  body_markdown, cta_type, cta_text, outline_approved_at, revision_count, quality_score, quality_below_threshold,
  is_paid_candidate, paid_candidate_evaluation, status
) values
('63000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
 'FREE', null,
 '50代。会社がなくなったら、あなたには何が残りますか？',
 '[
   {"title":"50代。会社がなくなったら、あなたには何が残りますか？","type":"疑問","click_score":88,"trust_score":82,"specificity_score":75,"sales_smell_score":10},
   {"title":"会社の看板を外した自分に、市場価値はあるか","type":"問題提起","click_score":80,"trust_score":78,"specificity_score":70,"sales_smell_score":12},
   {"title":"ChatGPTが5秒で終わらせた仕事と、20年かけた自分","type":"共感","click_score":85,"trust_score":80,"specificity_score":82,"sales_smell_score":8},
   {"title":"会社に依存しない自分を、辞める前に作っておく理由","type":"ベネフィット","click_score":78,"trust_score":76,"specificity_score":74,"sales_smell_score":18},
   {"title":"転職しなかった私が、それでも棚卸しをした告白","type":"告白","click_score":70,"trust_score":74,"specificity_score":68,"sales_smell_score":14}
 ]'::jsonb,
 '「ChatGPTに自分の仕事を要約させたら5秒で終わった」。笑い話のつもりで書いたその投稿に、同世代の会社員から驚くほど多くの共感が集まりました。今日は、その先にある「棚卸し」の話をします。',
 '会社という看板がなくなった時、自分自身に市場価値があるのかどうかがわからない',
 'この記事を読み終える頃には、自分の経験を棚卸しする最初の視点が手に入ります',
 '## なぜ「会社の看板を外した自分」を考える必要があるのか' || chr(10) || chr(10) ||
 '生成AIの導入によって、大手企業が事務職を段階的に削減する方針を発表するニュースが相次いでいます。「自分の会社はまだ大丈夫」と思っていても、AIに置き換え可能な業務がどれだけあるかは、会社の規模とは関係ありません。まずはこの現実を、他人事ではなく自分の仕事に当てはめて見てみることから始めます。' || chr(10) || chr(10) ||
 '## 自分の市場価値が見えなくなる3つの理由' || chr(10) || chr(10) ||
 '一つ目は、会社の看板と自分の実力を混同してしまうこと。二つ目は、日々の業務に追われて自分のスキルを言語化する機会が無いこと。三つ目は、比較対象が社内の同僚だけになり、外の市場の物差しを知らないことです。どれも特別なことではなく、多くの会社員に共通する構造的な問題です。' || chr(10) || chr(10) ||
 '## 棚卸しをしたある会社員の話' || chr(10) || chr(10) ||
 '経理部門で10年以上請求書処理を担当していたが、社内のDX推進チームへ異動し、生成AIを使った業務効率化ツールの導入を担当することになった、という会社員がいます。最初は自分の仕事がAIに奪われる側だと思っていたが、実際にはAIを使いこなす側に回れることに気づいた、と話していました。奪われるかどうかは、蓋を開けてみるまでわからないということです。' || chr(10) || chr(10) ||
 '## 今日からできる小さな棚卸しステップ' || chr(10) || chr(10) ||
 'いきなり転職活動を始める必要はありません。まずは今の仕事の中で「人から頼まれること」を10個書き出してみてください。それだけで、会社の看板を外した自分に何が残るのか、輪郭が見え始めるはずです。',
 'FOLLOW', '続きを知りたい方はフォローしてお待ちください。近日、実際に手を動かして棚卸しをするための実践編を予定しています。',
 now() - interval '2 hours', 0, 84, false,
 true,
 '{"problem_depth":82,"actionability":75,"repeat_value":70,"specificity":68,"transformation_value":78,"purchase_intent":72,"is_paid_candidate":true,"reasoning":"問題の深さと変化をもたらす価値は高く、棚卸しワークとして具体的な手順・テンプレートに展開すれば購入意欲が見込める。"}'::jsonb,
 'WAITING_APPROVAL')
on conflict (id) do nothing;

insert into public.gos_article_sections (
  id, user_id, article_id, heading, purpose, key_points, evidence_required, experience_required,
  content, source_ids, experience_ids, sort_order, manual_edited
) values
('64000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001',
 'なぜ「会社の看板を外した自分」を考える必要があるのか', '問題提起。AI導入という客観的事実から、読者自身の仕事へと視点を移す',
 '["生成AI導入による事務職削減の動き", "会社の規模と代替可能性は無関係"]'::jsonb, true, false,
 '生成AIの導入によって、大手企業が事務職を段階的に削減する方針を発表するニュースが相次いでいます。「自分の会社はまだ大丈夫」と思っていても、AIに置き換え可能な業務がどれだけあるかは、会社の規模とは関係ありません。まずはこの現実を、他人事ではなく自分の仕事に当てはめて見てみることから始めます。',
 array['10000000-0000-0000-0000-000000000004']::uuid[], '{}', 0, false),

('64000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001',
 '自分の市場価値が見えなくなる3つの理由', '深掘り。読者が自分に当てはめて考えられる構造を示す',
 '["看板と実力の混同", "スキルを言語化する機会の欠如", "社内比較しか物差しがない"]'::jsonb, false, false,
 '一つ目は、会社の看板と自分の実力を混同してしまうこと。二つ目は、日々の業務に追われて自分のスキルを言語化する機会が無いこと。三つ目は、比較対象が社内の同僚だけになり、外の市場の物差しを知らないことです。どれも特別なことではなく、多くの会社員に共通する構造的な問題です。',
 '{}', '{}', 1, false),

('64000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001',
 '棚卸しをしたある会社員の話', '体験。登録済みのExperience Libraryの実体験のみを使用する(捏造禁止)',
 '["実際に異動してAI導入を担当した経験", "奪われる側から使う側への転換"]'::jsonb, false, true,
 '経理部門で10年以上請求書処理を担当していたが、社内のDX推進チームへ異動し、生成AIを使った業務効率化ツールの導入を担当することになった、という会社員がいます。最初は自分の仕事がAIに奪われる側だと思っていたが、実際にはAIを使いこなす側に回れることに気づいた、と話していました。奪われるかどうかは、蓋を開けてみるまでわからないということです。',
 '{}', array['68000000-0000-0000-0000-000000000001']::uuid[], 2, false),

('64000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001',
 '今日からできる小さな棚卸しステップ', '行動喚起。低リスクで踏み出せる最初の一歩を提示する',
 '["いきなり転職しない", "「人から頼まれること」を10個書き出す"]'::jsonb, false, false,
 'いきなり転職活動を始める必要はありません。まずは今の仕事の中で「人から頼まれること」を10個書き出してみてください。それだけで、会社の看板を外した自分に何が残るのか、輪郭が見え始めるはずです。',
 '{}', '{}', 3, false)
on conflict (id) do nothing;

insert into public.gos_article_versions (id, user_id, target_type, target_id, version, content, created_by, reason) values
('65000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 1,
 (select body_markdown from public.gos_note_articles where id = '63000000-0000-0000-0000-000000000001'),
 'AI', '初回ドラフト生成')
on conflict (target_type, target_id, version) do nothing;

-- Fact Check: 数字を含む主張はSourceがなければUNVERIFIEDへ強制降格する(アプリ側ルール)ことを示す
insert into public.gos_fact_claims (id, user_id, article_id, section_id, claim, classification, source_id, confidence, action_required) values
('66000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', '64000000-0000-0000-0000-000000000001',
 '大手企業が生成AI導入により事務職を段階的に削減する方針を発表している', 'VERIFIED', '10000000-0000-0000-0000-000000000004', 92, false),
('66000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', '64000000-0000-0000-0000-000000000003',
 '経理部門で10年以上請求書処理を担当していたが、社内DX推進チームへ異動しAI導入を担当した', 'EXPERIENCE', null, 100, false),
('66000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001', null,
 '棚卸しワークを実践した読者の8割が自分の市場価値に自信を持てるようになる', 'UNVERIFIED', null, 40, true)
on conflict (id) do nothing;

insert into public.gos_content_funnels (id, user_id, idea_id, threads_post_ids, free_note_id, paid_note_id, product_id) values
('67000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
 array[
   '62000000-0000-0000-0000-000000000001', '62000000-0000-0000-0000-000000000002', '62000000-0000-0000-0000-000000000003',
   '62000000-0000-0000-0000-000000000004', '62000000-0000-0000-0000-000000000005'
 ]::uuid[],
 '63000000-0000-0000-0000-000000000001', null, null)
on conflict (idea_id) do nothing;

-- 初期商品(セクション25): 固定商品としてコードへハードコードせず、DBデータとして投入する
insert into public.gos_products (id, user_id, source_content_id, product_name, recommended_price, target, problem, solution, product_score, outline, status) values
('80000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '63000000-0000-0000-0000-000000000001',
 '50代会社員のための「会社に依存しない自分」発見ワーク', 980,
 '45〜59歳、会社に依存している自覚はあるが何から始めればいいか分からない会社員',
 '会社という看板を外した時、自分自身に市場価値があるのかどうかがわからない',
 '仕事・経験・人から頼まれることの棚卸しを通じて、会社に依存しない自分の輪郭を可視化するワーク',
 82,
 '["仕事棚卸し","経験棚卸し","人から頼まれること","AI代替リスクの整理","AIで強化できる仕事の整理","お金に変えられる経験の洗い出し","副業候補の絞り込み","30日行動計画"]'::jsonb,
 'PROPOSED')
on conflict (id) do nothing;

-- ============================================================
-- フェーズ3のAgentレビュー履歴(監査証跡サンプル)
-- ============================================================
insert into public.gos_ai_reviews (user_id, target_type, target_id, agent_type, score, verdict, feedback, raw_response) values
('a0000000-0000-0000-0000-000000000001', 'IDEA', '21000000-0000-0000-0000-000000000001', 'STRATEGY_EDITOR', null, null,
 'Content Strategyを生成しました: 会社を辞める必要はない。ただ、会社がなくても生きられる自分を今のうちに作っておこう', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'TITLE_GENERATOR', null, null,
 '推奨タイトル: 50代。会社がなくなったら、あなたには何が残りますか?(5案中)', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'OUTLINE_GENERATOR', null, null,
 '4セクション構成のOutlineを生成しました。人間の承認待ちです。', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'SECTION_WRITER', null, null,
 'Section「なぜ「会社の看板を外した自分」を考える必要があるのか」を執筆しました', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'SECTION_WRITER', null, null,
 'Section「棚卸しをしたある会社員の話」を執筆しました(Experience Library #1を使用)', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'STRATEGY_EDITOR', null, 'PASS',
 'Content Strategyで定めたターゲット・悩み・導線と本文が一致しています。', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'READER_50S_AGENT', null, 'PASS',
 '自分の話として読める内容で、説教感も無く最後まで読みやすいです。', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'CHIEF_EDITOR_AGENT', null, 'PASS',
 '冗長な箇所や不自然な三段構成は見られません。AI臭の指摘: なし', '[{"criterion":"hook","score":85,"reason":"具体的なエピソードから始まり引きが強い"},{"criterion":"empathy","score":84,"reason":"同世代の悩みに寄り添っている"},{"criterion":"clarity","score":88,"reason":"構成が明快"},{"criterion":"humanity","score":80,"reason":"登録済みの実体験を用いた具体性がある"},{"criterion":"originality","score":78,"reason":"「棚卸し」という切り口に独自性がある"},{"criterion":"usefulness","score":82,"reason":"具体的な次の一歩を提示している"},{"criterion":"credibility","score":86,"reason":"AI導入の事実はSourceに基づいている"},{"criterion":"structure","score":85,"reason":"導入から行動喚起までの流れが自然"},{"criterion":"cta","score":80,"reason":"無料noteから高額商品へ飛躍していない"},{"criterion":"commercial_potential","score":83,"reason":"有料ワークへの自然な布石になっている"}]'::jsonb),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'HUMANITY_CHECKER', 80, null,
 '架空の失敗談を作らず、登録済みの実体験を適切に使っている点を評価しています。', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'FACT_CHECK_AGENT', null, 'NEEDS_REVISION',
 '事実主張3件を抽出。うちUNVERIFIED 1件(公開前に人間の確認が必要です)', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'SALES_EDITOR_AGENT', 80, null,
 '無料noteとして売り込み臭は低く、CTAも自然にフォロー導線へつながっています。', null),
('a0000000-0000-0000-0000-000000000001', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'PAID_CANDIDATE_EVALUATOR', null, 'PASS',
 '問題の深さと変化をもたらす価値が高く、棚卸しワークとして有料化候補になり得ます。', null);

-- フェーズ3のAI Jobs(コスト表示サンプル)
insert into public.gos_ai_jobs (user_id, job_type, target_type, target_id, status, model, input_tokens, output_tokens, estimated_cost, started_at, completed_at) values
('a0000000-0000-0000-0000-000000000001', 'THREADS_GENERATE', 'IDEA', '21000000-0000-0000-0000-000000000001', 'SUCCEEDED', 'claude-sonnet-5', 2600, 1400, 0.02220, now() - interval '3 hours', now() - interval '3 hours'),
('a0000000-0000-0000-0000-000000000001', 'ARTICLE_ADVANCE', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'SUCCEEDED', 'claude-sonnet-5', 1900, 1100, 0.01920, now() - interval '2 hours 40 minutes', now() - interval '2 hours 40 minutes'),
('a0000000-0000-0000-0000-000000000001', 'ARTICLE_ADVANCE', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'SUCCEEDED', 'claude-sonnet-5', 4200, 2600, 0.04860, now() - interval '2 hours 20 minutes', now() - interval '2 hours 20 minutes'),
('a0000000-0000-0000-0000-000000000001', 'ARTICLE_ADVANCE', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'SUCCEEDED', 'claude-sonnet-5', 2100, 900, 0.01800, now() - interval '2 hours 10 minutes', now() - interval '2 hours 10 minutes'),
('a0000000-0000-0000-0000-000000000001', 'ARTICLE_ADVANCE', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'SUCCEEDED', 'claude-haiku-4-5', 1500, 500, 0.00170, now() - interval '2 hours', now() - interval '2 hours'),
('a0000000-0000-0000-0000-000000000001', 'PAID_CANDIDATE_EVALUATE', 'NOTE_ARTICLE', '63000000-0000-0000-0000-000000000001', 'SUCCEEDED', 'claude-sonnet-5', 1300, 600, 0.01020, now() - interval '1 hour', now() - interval '1 hour');
