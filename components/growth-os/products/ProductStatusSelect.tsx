"use client";

import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { updateProductStatusAction } from "@/lib/growth-os/actions";
import type { ProductStatus } from "@/lib/growth-os/types";

const STATUSES: ProductStatus[] = ["PROPOSED", "IN_DEVELOPMENT", "READY", "LAUNCHED", "ARCHIVED"];

export function ProductStatusSelect({ productId, status }: { productId: string; status: ProductStatus }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      className="w-40"
      defaultValue={status}
      disabled={isPending}
      onChange={(e) => startTransition(() => updateProductStatusAction(productId, e.target.value as ProductStatus))}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </Select>
  );
}
