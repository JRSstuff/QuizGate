"use client";

import React from "react";

interface MathTextProps {
  text: string;
  className?: string;
}

/**
 * Safely parses plain-text math notation into clean React typography:
 * - sqrt(...) -> radical with vinculum overbar
 * - root[n](...) -> nth-root radical with vinculum overbar
 * - x^2, a^(m+n) -> crisp <sup> elements
 * - !=, <=, >=, ->, +/- -> readable mathematical symbols
 * Zero dangerouslySetInnerHTML; 100% XSS-safe.
 */
export function MathText({ text, className }: MathTextProps) {
  return <span className={className}>{parseMathSegments(text)}</span>;
}

function normalizeSymbols(raw: string): string {
  return raw
    .replace(/!=/g, "≠")
    .replace(/<=/g, "≤")
    .replace(/>=/g, "≥")
    .replace(/->/g, "→")
    .replace(/\+\/-/g, "±")
    .replace(/ approx /gi, " ≈ ")
    .replace(/ \* /g, " · ");
}

function findMatchingParen(str: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseMathSegments(input: string, keyPrefix = "m"): React.ReactNode[] {
  const s = normalizeSymbols(input);
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < s.length) {
    // Match root[n](inner)
    if (s.startsWith("root[", i)) {
      const closeBracket = s.indexOf("](", i + 5);
      if (closeBracket !== -1) {
        const indexText = s.slice(i + 5, closeBracket);
        const openParen = closeBracket + 1;
        const closeParen = findMatchingParen(s, openParen);
        if (closeParen !== -1) {
          const inner = s.slice(openParen + 1, closeParen);
          nodes.push(
            <span key={`${keyPrefix}-r-${k++}`} className="math-rad">
              <span className="math-rad-idx">{indexText}</span>
              <span className="math-rad-sym">√</span>
              <span className="math-rad-vin">
                {parseMathSegments(inner, `${keyPrefix}-ri-${k}`)}
              </span>
            </span>
          );
          i = closeParen + 1;
          continue;
        }
      }
    }

    // Match sqrt(inner)
    if (s.startsWith("sqrt(", i)) {
      const openParen = i + 4;
      const closeParen = findMatchingParen(s, openParen);
      if (closeParen !== -1) {
        const inner = s.slice(openParen + 1, closeParen);
        nodes.push(
          <span key={`${keyPrefix}-sq-${k++}`} className="math-rad">
            <span className="math-rad-sym">√</span>
            <span className="math-rad-vin">
              {parseMathSegments(inner, `${keyPrefix}-sqi-${k}`)}
            </span>
          </span>
        );
        i = closeParen + 1;
        continue;
      }
    }

    // Match ^(exponent) or ^token (e.g. ^2, ^3, ^n, ^-1)
    if (s[i] === "^") {
      if (s[i + 1] === "(") {
        const closeParen = findMatchingParen(s, i + 1);
        if (closeParen !== -1) {
          const exp = s.slice(i + 2, closeParen);
          nodes.push(
            <sup key={`${keyPrefix}-sp-${k++}`} className="text-[0.72em] leading-none">
              {parseMathSegments(exp, `${keyPrefix}-spi-${k}`)}
            </sup>
          );
          i = closeParen + 1;
          continue;
        }
      } else {
        const m = s.slice(i + 1).match(/^-?[a-zA-Z0-9]+/);
        if (m) {
          nodes.push(
            <sup key={`${keyPrefix}-s-${k++}`} className="text-[0.72em] leading-none">
              {m[0]}
            </sup>
          );
          i += 1 + m[0].length;
          continue;
        }
      }
    }

    // Collect plain text chunk up to next special token
    let nextSpecial = s.length;
    for (const marker of ["root[", "sqrt(", "^"]) {
      const pos = s.indexOf(marker, i);
      if (pos !== -1 && pos < nextSpecial) nextSpecial = pos;
    }
    if (nextSpecial === i) {
      nodes.push(s[i]);
      i++;
    } else {
      nodes.push(s.slice(i, nextSpecial));
      i = nextSpecial;
    }
  }

  return nodes;
}
