import React from 'react';
import { resolveImgUrl } from '../../utils';

export function MessageText({ text }: { text: string }) {
  const renderInline = (s: string): React.ReactNode[] => {
    const imgParts = s.split(/(!\[[^\]]*\]\([^)]+\))/g);
    const out: React.ReactNode[] = [];
    imgParts.forEach((chunk, ci) => {
      const img = chunk.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (img) {
        const rawSrc = img[2].trim();
        const imgSafe = /^(https?:\/\/|\/|data:image\/)/i.test(rawSrc);
        if (imgSafe) {
          const src = resolveImgUrl(rawSrc, img[1]);
          out.push(
            <img
              key={`i${ci}`}
              src={src}
              alt={img[1]}
              loading="lazy"
              className="block max-h-56 w-auto rounded-lg border border-neutral-200 bg-white my-1.5 shadow-sm"
            />
          );
        } else {
          out.push(<span key={`i${ci}`}>{img[1]}</span>);
        }
        return;
      }
      chunk.split(/(\[[^\]]+\]\([^)]+\))/g).forEach((part, i) => {
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const href = link[2].trim();
          const safe = /^(https?:\/\/|\/|#)/i.test(href);
          out.push(
            safe ? (
              <a
                key={`a${ci}-${i}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-600 underline underline-offset-2 hover:text-red-700"
              >
                {link[1]}
              </a>
            ) : (
              <span key={`a${ci}-${i}`}>{link[1]}</span>
            )
          );
        } else {
          part.split(/(\*\*[^*]+\*\*)/g).forEach((b, bi) =>
            out.push(
              b.startsWith('**') && b.endsWith('**') ? (
                <strong key={`b${ci}-${i}-${bi}`} className="font-semibold text-neutral-900">
                  {b.slice(2, -2)}
                </strong>
              ) : (
                b
              )
            )
          );
        }
      });
    });
    return out;
  };

  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      blocks.push(<div key={`s${i}`} className="h-1" />);
      i++;
      continue;
    }

    // Fenced Code Blocks (e.g. ```gcode or ```text)
    if (t.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++; // skip closing fence
      }
      blocks.push(
        <div key={`c${i}`} className="my-2.5 overflow-x-auto rounded-xl bg-neutral-900 text-neutral-100 p-3 font-mono text-xs border border-neutral-800 shadow-sm leading-relaxed -mx-1 sm:mx-0">
          <pre className="whitespace-pre">{codeLines.join('\n')}</pre>
        </div>
      );
      continue;
    }

    // Markdown Tables with mobile-optimized horizontal scrolling
    if (t.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
      const rows: string[][] = [];
      const head = t.split('|').slice(1, -1).map(c => c.trim());
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().split('|').slice(1, -1).map(c => c.trim()));
        i++;
      }
      blocks.push(
        <div key={`t${i}`} className="overflow-x-auto my-3 -mx-1 sm:mx-0 rounded-xl border border-neutral-200/90 shadow-sm bg-white scroll-thin">
          <table className="text-xs border-collapse w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-100/80">
                {head.map((c, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-bold text-neutral-800 tracking-tight">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200/70">
              {rows.map((r, ri) => (
                <tr key={ri} className={ri % 2 === 1 ? 'bg-neutral-50/60 hover:bg-red-50/30 transition-colors' : 'hover:bg-red-50/30 transition-colors'}>
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-2 align-top text-neutral-700">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (t.startsWith('###') || t.startsWith('##')) {
      blocks.push(
        <p key={`h${i}`} className="font-bold text-neutral-950 mt-3 text-sm tracking-tight">
          {t.replace(/^#+\s*/, '')}
        </p>
      );
      i++;
      continue;
    }
    if (/^[-•]\s/.test(t)) {
      blocks.push(
        <p key={`l${i}`} className="pl-4 relative text-neutral-800">
          <span className="absolute left-1 text-red-600 font-bold">•</span>
          {renderInline(t.replace(/^[-•]\s/, ''))}
        </p>
      );
      i++;
      continue;
    }
    blocks.push(<p key={`p${i}`} className="text-neutral-800">{renderInline(lines[i])}</p>);
    i++;
  }

  return <div className="text-sm leading-relaxed space-y-1.5">{blocks}</div>;
}

export default MessageText;
