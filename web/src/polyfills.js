// Navigateurs de Smart TV (Chromium 63-68) : compléments ES2019 non fournis par la transpilation.
if (!Object.fromEntries) {
  Object.fromEntries = (iter) => {
    const o = {};
    for (const [k, v] of iter) o[k] = v;
    return o;
  };
}
