/** Widget CSS. Lives in a shadow root, so host pages can't restyle it. */
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.bd {
  --bd-primary: #6d5df5;
  --bd-on-primary: #fff;
  --bd-bg: #ffffff;
  --bd-surface: #f6f6f8;
  --bd-border: #e6e6ec;
  --bd-text: #18181b;
  --bd-muted: #6b6b76;
  --bd-radius: 18px;
  --bd-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font: 14px/1.5 var(--bd-font);
  color: var(--bd-text);
  position: fixed; bottom: 20px; z-index: 2147483000;
}
.bd.right { right: 20px; } .bd.left { left: 20px; }
@media (prefers-color-scheme: dark) {
  .bd.auto { --bd-bg: #18181b; --bd-surface: #232329; --bd-border: #34343c; --bd-text: #f4f4f5; --bd-muted: #a1a1aa; }
}

.launcher {
  display: flex; align-items: center; gap: 8px; height: 56px; min-width: 56px; padding: 0 18px;
  border: 0; border-radius: 999px; cursor: pointer; background: var(--bd-primary); color: var(--bd-on-primary);
  font: 600 15px/1 var(--bd-font); box-shadow: 0 8px 24px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.12);
  transition: transform .15s ease, box-shadow .15s ease;
}
.launcher.icon-only { padding: 0; justify-content: center; width: 56px; }
.launcher:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(0,0,0,.22); }
.launcher:focus-visible, button:focus-visible, textarea:focus-visible, input:focus-visible, a:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--bd-primary) 45%, transparent); outline-offset: 2px;
}
.launcher svg { width: 24px; height: 24px; }
.unread { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #ef4444; color: #fff; font-size: 11px; display: grid; place-items: center; }

.panel {
  position: absolute; bottom: 72px; width: 380px; height: min(640px, calc(100vh - 110px));
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bd-bg); border: 1px solid var(--bd-border); border-radius: var(--bd-radius);
  box-shadow: 0 24px 64px rgba(0,0,0,.22), 0 4px 12px rgba(0,0,0,.08);
  transform-origin: bottom right; animation: bd-in .18s ease-out;
}
.bd.left .panel { transform-origin: bottom left; }
.bd.right .panel { right: 0; } .bd.left .panel { left: 0; }
.panel[hidden] { display: none; }
@keyframes bd-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { .panel { animation: none; } .launcher { transition: none; } .dots span { animation: none !important; } }
@media (max-width: 480px) {
  .bd { bottom: 12px; } .bd.right { right: 12px; } .bd.left { left: 12px; }
  .panel { position: fixed; inset: 0; width: auto; height: auto; border-radius: 0; border: 0; }
}

.head { display: flex; align-items: center; gap: 12px; padding: 14px 14px 14px 16px; background: var(--bd-primary); color: var(--bd-on-primary); }
.avatar { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,.2); display: grid; place-items: center; flex: none; overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.head-text { flex: 1; min-width: 0; }
.title { font-weight: 650; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.subtitle { font-size: 12.5px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { width: 36px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; }
.icon-btn:hover { background: rgba(255,255,255,.16); }
.icon-btn svg { width: 20px; height: 20px; }

.log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; scroll-behavior: smooth; }
.msg { max-width: 86%; display: flex; flex-direction: column; gap: 4px; }
.msg.user { align-self: flex-end; align-items: flex-end; }
.bubble { padding: 10px 13px; border-radius: 16px; word-wrap: break-word; overflow-wrap: anywhere; }
.msg.user .bubble { background: var(--bd-primary); color: var(--bd-on-primary); border-bottom-right-radius: 6px; }
.msg.bot .bubble, .msg.agent .bubble { background: var(--bd-surface); border-bottom-left-radius: 6px; }
.msg.agent .who { font-size: 11.5px; color: var(--bd-muted); font-weight: 600; }
.bubble p { margin: 0 0 8px; } .bubble p:last-child { margin: 0; }
.bubble ul, .bubble ol { margin: 4px 0 8px; padding-left: 20px; }
.bubble a { color: inherit; text-decoration: underline; }
.bubble code { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; background: rgba(0,0,0,.06); padding: 1px 4px; border-radius: 4px; }
.bd-cite { display: inline-grid; place-items: center; min-width: 17px; height: 17px; padding: 0 4px; margin: 0 1px; vertical-align: 2px;
  border: 0; border-radius: 6px; cursor: pointer; font: 600 10.5px/1 var(--bd-font);
  background: color-mix(in srgb, var(--bd-primary) 16%, transparent); color: var(--bd-primary); }
.sources { font-size: 12.5px; color: var(--bd-muted); }
.sources summary { cursor: pointer; list-style: none; display: inline-flex; gap: 4px; align-items: center; }
.sources summary::-webkit-details-marker { display: none; }
.sources ol { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; }
.sources li.hl { color: var(--bd-text); }
.sources a { color: inherit; }
.src-title { font-weight: 600; color: var(--bd-text); }
.disclaimer { font-size: 11.5px; color: var(--bd-muted); }
.meta { display: flex; gap: 4px; align-items: center; }
.fb { border: 0; background: transparent; cursor: pointer; color: var(--bd-muted); padding: 4px; border-radius: 8px; display: grid; place-items: center; }
.fb:hover { background: var(--bd-surface); color: var(--bd-text); }
.fb.on { color: var(--bd-primary); }
.fb svg { width: 15px; height: 15px; }
.note { align-self: center; font-size: 12.5px; color: var(--bd-muted); text-align: center; padding: 4px 12px; }
.note.err { color: #b91c1c; }

.dots { display: inline-flex; gap: 4px; padding: 4px 0; }
.dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--bd-muted); animation: bd-dot 1s infinite ease-in-out; }
.dots span:nth-child(2) { animation-delay: .15s; } .dots span:nth-child(3) { animation-delay: .3s; }
@keyframes bd-dot { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

.chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 12px; }
.chip { border: 1px solid var(--bd-border); background: var(--bd-bg); color: var(--bd-text); border-radius: 999px; padding: 7px 12px; cursor: pointer; font: 13px/1.2 var(--bd-font); text-align: left; }
.chip:hover { border-color: var(--bd-primary); color: var(--bd-primary); }
.action { align-self: flex-start; border: 1px solid var(--bd-primary); color: var(--bd-primary); background: transparent; border-radius: 999px; padding: 7px 14px; cursor: pointer; font: 600 13px/1 var(--bd-font); }
.action:hover { background: color-mix(in srgb, var(--bd-primary) 10%, transparent); }

.form { align-self: stretch; display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--bd-border); border-radius: 14px; }
.form label { font-size: 12px; color: var(--bd-muted); display: flex; flex-direction: column; gap: 4px; }
.form input, .form textarea { font: 14px/1.4 var(--bd-font); color: var(--bd-text); background: var(--bd-bg); border: 1px solid var(--bd-border); border-radius: 10px; padding: 8px 10px; }
.form .row { display: flex; gap: 8px; justify-content: flex-end; }
.btn { border: 0; border-radius: 10px; padding: 8px 14px; cursor: pointer; font: 600 13px/1 var(--bd-font); background: var(--bd-primary); color: var(--bd-on-primary); }
.btn.ghost { background: transparent; color: var(--bd-muted); }

.compose { display: flex; align-items: flex-end; gap: 8px; padding: 12px; border-top: 1px solid var(--bd-border); }
.compose textarea { flex: 1; resize: none; max-height: 120px; min-height: 42px; padding: 10px 12px; border: 1px solid var(--bd-border); border-radius: 14px;
  font: 14px/1.4 var(--bd-font); color: var(--bd-text); background: var(--bd-bg); }
.compose textarea:focus { border-color: var(--bd-primary); outline: none; }
.send { width: 42px; height: 42px; border: 0; border-radius: 12px; cursor: pointer; background: var(--bd-primary); color: var(--bd-on-primary); display: grid; place-items: center; flex: none; }
.send:disabled { opacity: .45; cursor: default; }
.send svg { width: 18px; height: 18px; }
.foot { text-align: center; font-size: 11px; color: var(--bd-muted); padding: 0 0 8px; }
.foot a { color: inherit; text-decoration: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`
