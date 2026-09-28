// BookNStyle Pro billing page (https://app.booknstyle.com/pro/).
// See the comment in index.html for why it exists.
//
// Safety rules for this file:
//   * Text from the server or the user is only ever set with textContent —
//     never innerHTML — so nothing typed into a profile can become markup.
//   * We only send the browser to Stripe's own pages (checked below).
//   * No trackers or analytics.
(function () {
  'use strict';

  var SUPABASE_URL = 'https://ebrxekhmlxlccuvcwiwb.supabase.co';
  // Supabase's PUBLIC publishable key — the same one inside the app and on
  // this site's invite pages. It can only do what the anon role may do.
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Vc4MPxSdXx1FmL3562bLUQ_A_KwQeVe';
  var PAGE_URL = 'https://app.booknstyle.com/pro/';
  var FUNCTION = 'stripe-create-subscription-checkout';
  // Stripe Checkout and the Stripe billing page. Nothing else.
  var STRIPE_URL = /^https:\/\/(checkout|billing)\.stripe\.com\//;

  var ACTIVE = ['active', 'trialing'];
  var PROBLEM = ['past_due', 'unpaid', 'incomplete'];
  var PRICES = {
    monthly: { label: '$20', per: '/month', then: ' Then $20 each month on that same date.' },
    annual: { label: '$216', per: '/year', then: ' Then $216 once a year, on that same date each year. 10% less than paying monthly.' }
  };

  function $(id) { return document.getElementById(id); }
  function show(id) { $(id).hidden = false; }
  function hide(id) { $(id).hidden = true; }
  var VIEWS = ['loading', 'view-return', 'view-signin', 'view-account', 'view-error'];
  function view(id, focusId) {
    VIEWS.forEach(function (v) { $(v).hidden = v !== id; });
    // Move focus to the new heading so screen readers announce the change.
    if (focusId) { try { $(focusId).focus(); } catch (e) { /* ignore */ } }
  }
  function notice(id, kind, text) {
    var el = $(id);
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.className = 'notice ' + kind;
    el.textContent = text;
    el.hidden = false;
  }
  function busy(button, on, label) {
    if (on) {
      button.dataset.label = button.textContent;
      button.textContent = label || 'One moment…';
      button.disabled = true;
    } else {
      if (button.dataset.label) button.textContent = button.dataset.label;
      button.disabled = false;
    }
  }
  function longDate(value) {
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  // The free month ends on the same calendar day next month (clamped to the
  // month's last day). Same rule as the app and the checkout function.
  function trialEndDate() {
    var d = new Date();
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d;
  }

  // What Stripe sent the pro back with, read once and then cleared from the
  // address bar so a reload doesn't repeat the message.
  var params = new URLSearchParams(location.search);
  var checkout = params.get('checkout');       // 'success' | 'cancel'
  var portalDone = params.get('portal') === 'done';
  var fromApp = params.get('from') === 'app';
  if ((checkout || portalDone || fromApp) && history.replaceState) {
    try { history.replaceState(null, '', '/pro/' + location.hash); } catch (e) { /* keep it */ }
  }

  // Back from Stripe, sent there by the iPhone app: the pro isn't signed in
  // here, and doesn't need to be. Point them back to the app.
  if (fromApp && (checkout || portalDone)) {
    if (checkout === 'success') {
      $('return-title').textContent = 'You’re all set';
      $('return-text').textContent = 'Your Pro plan is ready. Open BookNStyle to keep going.';
    } else if (checkout === 'cancel') {
      $('return-title').textContent = 'No changes made';
      $('return-text').textContent = 'You weren’t charged. Open BookNStyle to go back.';
    } else {
      $('return-title').textContent = 'All done';
      $('return-text').textContent = 'Open BookNStyle to go back.';
    }
    view('view-return', 'return-title');
    return;
  }

  if (!window.supabase || !window.supabase.createClient) {
    view('view-error', 'error-title');
    return;
  }

  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
      storageKey: 'booknstyle-pro-billing'
    }
  });

  // ---------------------------------------------------------------------
  // Signed out: email + password, or an emailed code.
  // ---------------------------------------------------------------------
  var otpEmail = '';

  function showSignIn(message, kind) {
    hide('code-form');
    show('otp-form');
    notice('signin-notice', kind || 'info', message || '');
    view('view-signin', 'signin-title');
  }

  $('password-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = $('pw-email').value.trim();
    var password = $('pw-password').value;
    if (!email || !password) {
      notice('signin-notice', 'error', 'Enter your email and password.');
      return;
    }
    var button = $('pw-submit');
    busy(button, true, 'Signing in…');
    client.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      busy(button, false);
      if (res.error) {
        notice('signin-notice', 'error', res.error.status === 429
          ? 'Too many tries. Wait a minute and try again.'
          : 'That email and password don’t match. Signed up with Apple, Google or Facebook? Use a sign-in code instead.');
        return;
      }
      $('pw-password').value = '';
      // onAuthStateChange shows the account.
    });
  });

  $('otp-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = $('otp-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      notice('signin-notice', 'error', 'Enter the email on your BookNStyle account.');
      return;
    }
    var button = $('otp-send');
    busy(button, true, 'Sending…');
    client.auth.signInWithOtp({
      email: email,
      // Never creates an account: this page is for existing pros only.
      options: { shouldCreateUser: false, emailRedirectTo: PAGE_URL }
    }).then(function (res) {
      busy(button, false);
      if (res.error && res.error.status === 429) {
        notice('signin-notice', 'error', 'Too many codes asked for. Wait a minute and try again.');
        return;
      }
      if (res.error && res.error.status >= 500) {
        notice('signin-notice', 'error', 'We couldn’t send a code right now. Try again in a minute.');
        return;
      }
      // Same message whether or not the email has an account, so this form
      // can't be used to find out who uses BookNStyle.
      otpEmail = email;
      $('code-email').textContent = email;
      $('otp-code').value = '';
      hide('otp-form');
      show('code-form');
      notice('signin-notice', 'info', 'If there’s a BookNStyle account for that email, we sent it a sign-in code. It can take a minute. Check spam, too.');
      $('otp-code').focus();
    });
  });

  $('code-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var code = $('otp-code').value.replace(/\s+/g, '');
    if (!/^[0-9]{6,10}$/.test(code)) {
      notice('signin-notice', 'error', 'Enter the code from the email.');
      return;
    }
    var button = $('code-submit');
    busy(button, true, 'Signing in…');
    client.auth.verifyOtp({ email: otpEmail, token: code, type: 'email' }).then(function (res) {
      busy(button, false);
      if (res.error) {
        notice('signin-notice', 'error', 'That code didn’t work. Check it, or send a new one.');
        return;
      }
      // onAuthStateChange shows the account.
    });
  });

  $('code-back').addEventListener('click', function () {
    showSignIn('');
    $('otp-email').value = otpEmail;
    $('otp-email').focus();
  });

  // ---------------------------------------------------------------------
  // Signed in: the pro's plan.
  // ---------------------------------------------------------------------
  var plan = null;          // the row from get_my_pro_plan
  var shownFor = null;      // user id the account view is showing

  function selectedPlan() {
    var checked = document.querySelector('input[name="plan"]:checked');
    return checked && checked.value === 'monthly' ? 'monthly' : 'annual';
  }

  function renderChoose() {
    var chosen = selectedPlan();
    $('plan-annual').classList.toggle('selected', chosen === 'annual');
    $('plan-monthly').classList.toggle('selected', chosen === 'monthly');
    var price = PRICES[chosen];
    var trial = !!(plan && plan.trial_eligible);
    $('start').textContent = trial
      ? 'Start free month, then ' + price.label + price.per
      : 'Continue to payment: ' + price.label + price.per;
    $('choose-fine').textContent = (trial
      ? 'First month free: you won’t be charged until ' + longDate(trialEndDate()) + '.' + price.then
      : 'You’re charged today.' + price.then) +
      ' Payment is processed by Stripe. Cancel anytime. You keep access until the end of your billing period.';
  }

  function renderPlan(user) {
    ['plan-notpro', 'plan-active', 'plan-problem', 'plan-choose'].forEach(hide);
    $('who-email').textContent = user.email || '';
    var sub = $('account-sub');
    if (plan && plan.name) {
      sub.textContent = plan.name;
      sub.hidden = false;
    } else {
      sub.hidden = true;
    }

    if (!plan || !plan.is_pro) {
      $('account-title').textContent = 'Not a pro account';
      show('plan-notpro');
      return;
    }
    $('account-title').textContent = 'Your Pro plan';
    var status = plan.status || 'none';

    if (ACTIVE.indexOf(status) >= 0) {
      var trialing = status === 'trialing';
      $('active-badge').textContent = trialing ? 'Free month' : 'Active';
      // Active with no billing record (plan is null): a demo or comped pro
      // that BookNStyle turned on by hand. There's no Stripe plan, no bill
      // date and nothing to manage, so don't show a made-up $20/month plan
      // or a Manage button that can only fail.
      var billed = !!plan.plan;
      $('active-date-row').hidden = !billed;
      $('manage').hidden = !billed;
      $('manage-fine').hidden = !billed;
      if (!billed) {
        $('active-plan').textContent = 'Pro';
        $('active-text').textContent = 'Your Pro plan is set up by BookNStyle. There’s nothing to pay here.';
        show('plan-active');
        return;
      }
      $('active-plan').textContent = plan.plan === 'annual' ? 'Annual · $216/year' : 'Monthly · $20/month';
      var date = longDate(plan.current_period_end);
      if (plan.cancel_at_period_end) {
        $('active-date-label').textContent = 'Ends on';
        $('active-text').textContent = 'Your plan is set to end. You keep full access until then.';
      } else {
        $('active-date-label').textContent = trialing ? 'First bill on' : 'Next bill on';
        $('active-text').textContent = 'You’re all set. Clients can find you and book you.';
      }
      $('active-date').textContent = date || '—';
      show('plan-active');
      return;
    }
    if (PROBLEM.indexOf(status) >= 0) {
      show('plan-problem');
      return;
    }
    renderChoose();
    show('plan-choose');
  }

  function loadPlan() {
    return client.rpc('get_my_pro_plan').then(function (res) {
      if (res.error) throw res.error;
      var rows = Array.isArray(res.data) ? res.data : (res.data ? [res.data] : []);
      plan = rows[0] || null;
      return plan;
    });
  }

  // After Stripe says "paid", our webhook updates the plan a few seconds
  // later. Check a few times before saying it's still on its way.
  function waitForActive(user, triesLeft) {
    return loadPlan().then(function () {
      if ((plan && ACTIVE.indexOf(plan.status) >= 0) || triesLeft <= 0) return;
      return new Promise(function (r) { setTimeout(r, 2000); }).then(function () {
        return waitForActive(user, triesLeft - 1);
      });
    });
  }

  // `message` (optional): a note to show above the plan, e.g. why the page
  // was drawn again.
  function showAccount(user, message) {
    shownFor = user.id;
    view('loading');
    var loading = checkout === 'success' ? waitForActive(user, 6) : loadPlan();
    loading.then(function () {
      renderPlan(user);
      if (message) {
        notice('account-notice', 'info', message);
      } else if (checkout === 'success') {
        notice('account-notice', 'ok', plan && ACTIVE.indexOf(plan.status) >= 0
          ? 'Thanks! Your Pro plan is active. Open the BookNStyle app to keep going.'
          : 'Thanks! Your payment went through. Your plan will show here in a minute. Reload to check.');
      } else if (checkout === 'cancel') {
        notice('account-notice', 'info', 'No changes made. You weren’t charged.');
      } else if (portalDone) {
        notice('account-notice', 'info', 'Back from billing. Changes can take a minute to show here.');
      }
      checkout = null;
      portalDone = false;
      view('view-account', 'account-title');
    }).catch(function () {
      $('error-title').textContent = 'We couldn’t load your plan';
      $('error-text').textContent = 'Check your connection and reload the page.';
      view('view-error', 'error-title');
    });
  }

  // Call the checkout function; it answers with a Stripe URL to go to.
  function goToStripe(body, button, label) {
    notice('account-notice', 'info', '');
    busy(button, true, label);
    client.functions.invoke(FUNCTION, { body: body }).then(function (res) {
      if (res.error) {
        busy(button, false);
        // The function's HTTP status (the error carries the response).
        var ctx = res.error.context;
        var status = ctx && typeof ctx.status === 'number' ? ctx.status : 0;
        if (status === 409) {
          // Already subscribed (another tab, the app, or turned on by
          // BookNStyle). Show the plan again, and always say why, so the pro
          // is never left on a button that seems to do nothing.
          return client.auth.getUser().then(function (u) {
            if (u.data && u.data.user) showAccount(u.data.user, 'Your account already has an active Pro plan.');
          });
        }
        if (status === 401) {
          client.auth.signOut();
          return;
        }
        notice('account-notice', 'error', status === 404
          ? 'We couldn’t find a plan to manage. Reload the page.'
          : 'We couldn’t open the payment page. Try again in a minute.');
        return;
      }
      var url = res.data && res.data.url;
      if (typeof url !== 'string' || !STRIPE_URL.test(url)) {
        busy(button, false);
        notice('account-notice', 'error', 'We couldn’t open the payment page. Try again in a minute.');
        return;
      }
      // Leave the button busy: the browser is on its way to Stripe.
      location.assign(url);
    }).catch(function () {
      busy(button, false);
      notice('account-notice', 'error', 'We couldn’t reach BookNStyle. Check your connection and try again.');
    });
  }

  $('plan-choose').addEventListener('change', renderChoose);
  $('plan-choose').addEventListener('submit', function (ev) {
    ev.preventDefault();
    goToStripe({ plan: selectedPlan(), return_to: 'web' }, $('start'), 'Opening secure checkout…');
  });
  $('manage').addEventListener('click', function () {
    goToStripe({ action: 'portal', return_to: 'web' }, $('manage'), 'Opening…');
  });
  $('fix-card').addEventListener('click', function () {
    goToStripe({ action: 'portal', return_to: 'web' }, $('fix-card'), 'Opening…');
  });
  $('sign-out').addEventListener('click', function () {
    client.auth.signOut();
  });

  // ---------------------------------------------------------------------
  // Start: whoever is signed in (a saved session, or one that just arrived
  // from an emailed link) decides the view.
  // ---------------------------------------------------------------------
  client.auth.onAuthStateChange(function (event, session) {
    // Supabase runs this callback while it holds its auth lock; do the
    // work just after, so our own calls don't wait on that lock.
    setTimeout(function () {
      var user = session && session.user;
      if (!user) {
        shownFor = null;
        plan = null;
        if (checkout === 'success') {
          showSignIn('Thanks! Your payment went through. Sign in to see your plan.', 'ok');
        } else if (checkout === 'cancel') {
          showSignIn('No changes made. You weren’t charged.', 'info');
        } else {
          showSignIn(event === 'SIGNED_OUT' ? 'You’re signed out.' : '');
        }
        checkout = null;
        portalDone = false;
        return;
      }
      // Already showing this pro: token refreshes (and the SIGNED_IN that
      // Supabase repeats when the tab comes back) don't need a reload.
      if (shownFor === user.id) return;
      showAccount(user);
    }, 0);
  });
})();
