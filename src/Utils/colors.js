const COLORS = {
  grey: 0x808080,
  red: 0xe03c3c,
  orange: 0xf28c28,
  yellow: 0xf2d024,
  green: 0x2ecc71,
  lime: 0xa4de02,
  teal: 0x1abc9c,
  cyan: 0x00bcd4,
  blue: 0x3b82f6,
  navy: 0x1e3a8a,
  purple: 0x9b59b6,
  pink: 0xff69b4,
  maroon: 0x800000,
  brown: 0x8b5a2b,
  gold: 0xd4af37,
  white: 0xffffff,
  black: 0x111111,
};

const ALIASES = { gray: 'grey' };

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const COLOR_NAMES = Object.keys(COLORS).map(titleCase);

// Accepts a color name from the list or a hex code like #FF8800.
function parseColor(input) {
  const v = String(input).trim().toLowerCase();
  const key = ALIASES[v] || v;
  if (COLORS[key] !== undefined) return { value: COLORS[key], name: titleCase(key) };
  const hex = v.match(/^#?([0-9a-f]{6})$/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { value: n === 0 ? 0x010101 : n, name: `#${hex[1].toUpperCase()}` };
  }
  return null;
}

module.exports = { COLOR_NAMES, parseColor };
