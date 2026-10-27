import { Fragment, memo } from "react";
import type { Block, Page } from "../../api";
import { registerBlock } from "./highlight";

function tagFor(block: Block): "h1" | "h2" | "h3" | "h4" | "blockquote" | "p" {
  if (block.kind === "title") return "h1";
  if (block.kind === "heading") return (["h2", "h3", "h4"] as const)[Math.min(Math.max((block.level ?? 1) - 1, 0), 2)];
  if (block.kind === "quote") return "blockquote";
  return "p";
}

const BlockView = memo(function BlockView({ block }: { block: Block }) {
  const Tag = tagFor(block);
  const words = block.text.split(" ");
  const last = words.length - 1;
  return (
    <Tag
      ref={(el: HTMLElement | null) => registerBlock(block.index, el)}
      className={`blk blk-${block.kind}${block.level ? ` lvl-${block.level}` : ""}`}
      data-block={block.index}
    >
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="w" data-b={block.index} data-w={i}>
            {w}
          </span>
          {i < last ? " " : null}
        </Fragment>
      ))}
    </Tag>
  );
});

interface Props {
  page: Page;
  label: string;
  /** null → rendered; number → placeholder of that height. */
  placeholderHeight: number | null;
}

export const PageView = memo(function PageView({ page, label, placeholderHeight }: Props) {
  if (placeholderHeight !== null) {
    return <section data-page={page.index} data-placeholder="" style={{ height: placeholderHeight }} aria-hidden />;
  }
  return (
    <section data-page={page.index} aria-label={label}>
      {page.index > 0 && (
        <div className="page-divider" aria-hidden>
          {label}
        </div>
      )}
      {page.blocks.map((b) => (
        <BlockView key={b.index} block={b} />
      ))}
    </section>
  );
});
