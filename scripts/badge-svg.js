/**
 * Render a flat label/value badge as SVG, in the shields.io style, so the
 * generated badges (coverage, CodeQL) sit naturally next to the hosted ones.
 */
'use strict';

/**
 * @param {string} label - Left side, grey background
 * @param {string} value - Right side, coloured background
 * @param {string} colour - CSS colour of the value side
 * @returns {string} The SVG document
 */
const badgeSvg = (label, value, colour) => {
  // 6px per character plus padding is close enough to Verdana 11 for these
  // short strings, and keeps the badge dependency-free.
  const labelWidth = label.length * 6.5 + 12;
  const valueWidth = value.length * 6.5 + 12;
  const width = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${colour}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelWidth * 5}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 12) * 10}">${label}</text>
    <text x="${labelWidth * 5}" y="140" transform="scale(.1)" textLength="${(labelWidth - 12) * 10}">${label}</text>
    <text aria-hidden="true" x="${(labelWidth + valueWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueWidth - 12) * 10}">${value}</text>
    <text x="${(labelWidth + valueWidth / 2) * 10}" y="140" transform="scale(.1)" textLength="${(valueWidth - 12) * 10}">${value}</text>
  </g>
</svg>
`;
};

module.exports = { badgeSvg };
