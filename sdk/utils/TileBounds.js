export const bounds_from_short_code = (short_code) => {
  let left = -2;
  let right = 2;
  let top = 2;
  let bottom = -2;
  let scope = 4.0;
  for (let i = 0; i < short_code.length; i++) {
    const half_scope = scope / 2;
    const digit = short_code[i];
    switch (digit) {
      case "0":
        right -= half_scope;
        bottom += half_scope;
        break;
      case "1":
        left += half_scope;
        bottom += half_scope;
        break;
      case "2":
        right -= half_scope;
        top -= half_scope;
        break;
      case "3":
        left += half_scope;
        top -= half_scope;
        break;
      default:
        debugger;
    }
    scope = half_scope;
  }
  return {
    left: left,
    right: right,
    top: top,
    bottom: bottom,
  };
};
