// CTA Engine(セクション19)のガード。固定CTAではなく内容の目的に応じてAIが選ぶ方式だが、
// 「無料noteが売り込み臭ゼロを装いながら高額商品へ直結する」ことだけはアプリ側で機械的に禁止する。

import type { CtaType, NoteArticleType } from "@/lib/growth-os/types";

/** 無料noteから直接PRODUCT(有料商品)へ誘導することは禁止し、有料noteを経由させる。 */
export function guardCtaForArticleType(articleType: NoteArticleType, ctaType: CtaType): CtaType {
  if (articleType === "FREE" && ctaType === "PRODUCT") {
    return "PAID_NOTE";
  }
  return ctaType;
}
