
  playRoot: {
    position: "fixed",
    inset: 0,
    height: "100dvh",
    boxSizing: "border-box",
    paddingTop: "env(safe-area-inset-top, 0px)",
    paddingBottom: "calc(56px + env(safe-area-inset-bottom, 0px))",
    touchAction: "none",
    overscrollBehavior: "none",
    display: "flex",
    flexDirection: "column",
    background: C.bg,
    color: C.ink,
    fontFamily: "'Nunito', sans-serif",
    userSelect: "none",
    WebkitUserSelect: "none",
  },
});

const S = makeStyles(C);
function applyTheme(isDark) {
  C = isDark ? { ...DARK, __dark: true } : { ...LIGHT, __dark: false };
  CSS = makeCSS(C);
}
