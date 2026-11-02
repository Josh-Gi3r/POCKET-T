<script lang="ts">
  import PTIcon from './PTIcon.svelte';
  // Informational until a signed Mac Keychain companion and E2E secret transfer are implemented.
</script>

<section class="vault">
  <div class="eyebrow">YOUR MAC <span>/</span> SECURE VALUES</div>
  <div class="hero">
    <div class="shield"><PTIcon name="shield" size={112} stroke={1.25}/></div>
    <span>PRIVATE BY DESIGN</span>
    <h1>Vault <em>& Values.</em></h1>
    <p>Store your reusable values and, when the secure Mac companion is ready, supply saved credentials to specific approved apps and workflows.</p>
    <div class="hero-status">◌ CREDENTIAL INPUT IS NOT ENABLED</div>
  </div>

  <div class="grid">
    <div class="tile">
      <div class="tile-icon"><PTIcon name="file" size={27}/></div>
      <strong>Reusable values</strong>
      <p>Project paths, aliases, standard form responses and other nonsecret information. Intended for one-tap insertion into a selected supported destination.</p>
      <span class="not-ready">NOT CONNECTED</span>
    </div>
    <div class="tile">
      <div class="tile-icon"><PTIcon name="shield" size={27}/></div>
      <strong>Keychain credentials</strong>
      <p>Passwords and tokens stored locally through a signed Mac companion. The cloud model can request use of an approved credential, but not read it.</p>
      <span class="not-ready">NOT CONNECTED</span>
    </div>
    <div class="tile">
      <div class="tile-icon"><PTIcon name="send" size={27}/></div>
      <strong>One-time secure input</strong>
      <p>Enter a secret on your phone for a specific app or website. A paired Mac would receive the encrypted value, validate the target, and attempt permitted entry.</p>
      <span class="not-ready">NOT CONNECTED</span>
    </div>
  </div>

  <div class="truth-panel">
    <div class="truth-head"><span><PTIcon name="shield" size={24}/></span><strong>What Pocket-T will and won't do</strong></div>
    <div class="truth-row"><span class="yes">✓</span><p>Can reuse a saved credential for explicitly approved workflows when the app, Mac Keychain and local security policy permit it.</p></div>
    <div class="truth-row"><span class="yes">✓</span><p>Can keep passwords out of OpenAI prompts, Telegram messages and the machine command history by using a separate local-secret delivery path.</p></div>
    <div class="truth-row"><span class="no">×</span><p>Cannot automatically unlock macOS, satisfy Touch ID/user-presence gates, defeat two-factor authentication, or bypass managed-device restrictions.</p></div>
    <div class="truth-row"><span class="no">×</span><p>This release does not accept or store any password. The necessary Mac Keychain and end-to-end encrypted delivery layer has not been built.</p></div>
  </div>
  <p class="foot">A password input form will only be enabled after authenticated Mac pairing, target-specific approval and end-to-end secret delivery have been implemented.</p>
</section>

<style>
  .vault{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:42px clamp(23px,4.7vw,76px) 110px;max-width:1260px;width:100%;margin:auto;color:var(--pt-ink)}
  .eyebrow{font-size:10px;font-weight:790;letter-spacing:1.2px;color:var(--pt-tertiary)}.eyebrow span{color:var(--pt-line-strong);margin:0 9px}
  .hero{position:relative;overflow:hidden;padding:46px 45px;border-radius:26px;background:linear-gradient(115deg,#312e63,#6e64b1 85%);color:white;margin:24px 0 23px;box-shadow:0 24px 54px #4d45872b}
  .shield{position:absolute;right:35px;top:29px;opacity:.15;transform:rotate(-12deg);color:white}
  .hero>span{font-size:10px;color:#d8d4ff;letter-spacing:1.3px;font-weight:780}
  .hero h1{font-size:clamp(37px,4vw,56px);line-height:1.15;letter-spacing:-.055em;margin:18px 0 13px;font-weight:750}
  .hero h1 em{font-style:normal;color:#dfd6ff;font-weight:530}
  .hero p{font-size:13px;color:#ebe8ff;max-width:530px;line-height:1.75;margin:0}
  .hero-status{display:inline-flex;padding:10px 13px;font-size:10px;font-weight:770;letter-spacing:.5px;color:#f0efff;background:#ffffff24;border:1px solid #ffffff54;border-radius:999px;margin-top:24px}
  .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
  .tile{display:flex;flex-direction:column;gap:10px;background:var(--pt-surface);border:1px solid var(--pt-line);border-radius:21px;box-shadow:var(--pt-shadow-small);padding:25px}
  .tile-icon{display:grid;place-items:center;height:50px;width:50px;border-radius:16px;background:var(--pt-violet-soft);color:var(--pt-violet);margin-bottom:10px}
  .tile strong{font-size:14px;font-weight:770}
  .tile p{flex:1;color:var(--pt-secondary);font-size:12px;line-height:1.75;margin:0;min-height:91px}
  .not-ready{display:inline-flex;align-self:flex-start;margin-top:7px;font-size:9px;letter-spacing:1px;color:var(--pt-tertiary);font-weight:800}
  .truth-panel{background:var(--pt-surface);border:1px solid var(--pt-line);border-radius:21px;padding:26px 30px;margin-top:23px;box-shadow:var(--pt-shadow-small)}
  .truth-head{display:flex;align-items:center;gap:11px;margin-bottom:19px}
  .truth-head span{display:grid;place-items:center;color:var(--pt-violet);width:40px;height:40px;background:var(--pt-violet-soft);border-radius:13px}
  .truth-head strong{font-size:15px;font-weight:750}
  .truth-row{display:flex;align-items:start;gap:14px;padding:13px 0;border-top:1px solid var(--pt-line)}
  .truth-row>span{display:grid;place-items:center;flex:none;width:20px;height:20px;font-size:17px;font-weight:800}
  .truth-row .yes{color:var(--pt-teal)}.truth-row .no{color:#d17c6d}
  .truth-row p{font-size:12px;line-height:1.7;color:var(--pt-secondary);margin:0}
  .foot{font-size:11px;color:var(--pt-tertiary);line-height:1.75;margin-top:23px}
  @media(max-width:720px){.vault{padding:25px 18px 126px}.hero{margin:20px 0 18px;padding:29px 25px;border-radius:21px}.hero h1{font-size:40px}.hero p{font-size:12px}.shield{right:-20px;top:-15px;opacity:.11}
    .grid{grid-template-columns:1fr;gap:10px}.tile{padding:20px;gap:8px}.tile-icon{margin-bottom:3px}.tile p{min-height:unset;font-size:11px}.truth-panel{padding:20px}.truth-row p{font-size:11px}
  }
</style>