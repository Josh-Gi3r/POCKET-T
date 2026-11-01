<section class="vault">
  <div class="eyebrow">YOUR MAC <span>/</span> SECURE VALUES</div>
  <div class="hero">
    <div class="shield">◈</div>
    <span>PRIVATE BY DESIGN</span>
    <h1>Vault <em>& Values.</em></h1>
    <p>Store your reusable values and, when the secure Mac companion is ready, supply saved credentials to specific approved apps and workflows.</p>
    <div class="hero-status">◌ CREDENTIAL INPUT IS NOT ENABLED</div>
  </div>

  <div class="grid">
    <div class="tile">
      <div class="tile-icon">◫</div>
      <strong>Reusable values</strong>
      <p>Project paths, aliases, standard form responses and other nonsecret information. Intended for one-tap insertion into a selected supported destination.</p>
      <span class="not-ready">NOT CONNECTED</span>
    </div>
    <div class="tile">
      <div class="tile-icon">⌑</div>
      <strong>Keychain credentials</strong>
      <p>Passwords and tokens stored locally through a signed Mac companion. The cloud model can request use of an approved credential, but not read it.</p>
      <span class="not-ready">NOT CONNECTED</span>
    </div>
    <div class="tile">
      <div class="tile-icon">⌖</div>
      <strong>One-time secure input</strong>
      <p>Enter a secret on your phone for a specific app or website. A paired Mac would receive the encrypted value, validate the target, and attempt permitted entry.</p>
      <span class="not-ready">NOT CONNECTED</span>
    </div>
  </div>

  <div class="truth-panel">
    <div class="truth-head"><span>⛨</span><strong>What Pocket-T will and won't do</strong></div>
    <div class="truth-row"><span class="yes">✓</span><p>Can reuse a saved credential for explicitly approved workflows when the app, Mac Keychain and local security policy permit it.</p></div>
    <div class="truth-row"><span class="yes">✓</span><p>Can keep passwords out of OpenAI prompts, Telegram messages and the machine command history by using a separate local-secret delivery path.</p></div>
    <div class="truth-row"><span class="no">×</span><p>Cannot automatically unlock macOS, satisfy Touch ID/user-presence gates, defeat two-factor authentication, or bypass managed-device restrictions.</p></div>
    <div class="truth-row"><span class="no">×</span><p>This release does not accept or store any password. The necessary Mac Keychain and end-to-end encrypted delivery layer has not been built.</p></div>
  </div>
  <p class="foot">A password input form will only be enabled after authenticated Mac pairing, target-specific approval and end-to-end secret delivery have been implemented.</p>
</section>

<style>
  .vault{flex:1;overflow-y:auto;padding:35px clamp(18px,4.5vw,70px) 55px;max-width:1320px;width:100%;margin:auto}
  .eyebrow{font-size:10px;color:#88a5a9;font-weight:850;letter-spacing:1.5px}.eyebrow span{color:#4b656b;margin:0 8px}
  .hero{position:relative;border:1px solid #355b51;background:radial-gradient(ellipse at 95% 0%,#24594755,transparent 50%),linear-gradient(115deg,#1b3433,#111f2b);padding:39px 41px;border-radius:20px;margin-top:25px;overflow:hidden}
  .shield{position:absolute;right:40px;top:40px;color:#a6ffcd;font-size:110px;opacity:.16}
  .hero>span{font-size:9px;letter-spacing:1.7px;color:#9fdec3;font-weight:850}.hero h1{font-size:clamp(39px,5vw,63px);letter-spacing:-2.5px;margin:15px 0 12px;line-height:1.1}.hero h1 em{color:#a9f2d1;font-style:normal}
  .hero p{max-width:520px;color:#a1bab9;font-size:13px;line-height:1.9;position:relative}.hero-status{margin-top:24px;border:1px solid #466756;background:#254138;color:#c2e4d1;padding:10px 13px;border-radius:8px;font-size:10px;letter-spacing:.8px;font-weight:800;display:inline-block}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:23px}
  .tile{background:#172630;border:1px solid #29434a;border-radius:16px;padding:25px;min-height:224px}
  .tile-icon{font-size:29px;color:#a9eaca;margin-bottom:21px}.tile strong{font-size:15px}.tile p{color:#93adb1;line-height:1.8;font-size:11px;min-height:70px}.not-ready{font-size:9px;color:#8aacac;letter-spacing:1.2px;font-weight:800}
  .truth-panel{padding:25px;background:#12222c;border:1px solid #2d4849;border-radius:16px;margin-top:22px}
  .truth-head{display:flex;align-items:center;gap:12px;margin-bottom:17px}.truth-head span{font-size:23px;color:#9edec5}.truth-head strong{font-size:16px}
  .truth-row{display:flex;align-items:flex-start;gap:12px;border-top:1px solid #263d43;padding:13px 0}.truth-row span{font-size:16px;width:19px;flex:none}.yes{color:#9ce6c5}.no{color:#efb4a4}.truth-row p{color:#a3b9bd;font-size:12px;line-height:1.7;margin:0}
  .foot{font-size:11px;color:#85a2a6;line-height:1.7;margin-top:17px}
  @media(max-width:760px){.vault{padding:23px 16px 40px}.hero{padding:30px 24px}.hero h1{font-size:44px}.hero p{font-size:12px}.shield{right:-5px;font-size:90px}
    .grid{grid-template-columns:1fr;gap:9px}.tile{min-height:unset;padding:20px}.tile-icon{margin-bottom:11px}.tile p{min-height:unset}
    .truth-panel{padding:18px}.truth-row p{font-size:11px}
  }
</style>
