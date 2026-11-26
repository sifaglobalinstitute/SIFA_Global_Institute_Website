
(() => {
  const cfg = window.SIFA_SUPABASE_CONFIG || {};
  const $ = id => document.getElementById(id);

  let sb;
  let session;
  let invoices = [];
  let approvedQuotes = [];
  const methodsByCurrency = {
    RWF: 'Rwanda Mobile Money',
    TRY: 'Ziraat Bank Transfer',
    USD: 'Ziraat USD Bank Transfer'
  };

  // Only show quotes returned by the authenticated billing service.
  function loadQuotes(result) {
    const values = [
      ...(Array.isArray(result.payment_quotes) ? result.payment_quotes : []),
      ...(Array.isArray(result.quotes) ? result.quotes : []),
      ...(Array.isArray(result.invoices) ? result.invoices.flatMap(i =>
        Array.isArray(i.payment_quotes) ? i.payment_quotes :
        Array.isArray(i.quotes) ? i.quotes : i.payment_quote ? [{...i.payment_quote, invoice_id:i.id, status:"approved"}] : []
      ) : [])
    ];
    const now = Date.now();
    approvedQuotes = values.filter(q =>
      q && q.status === 'approved' &&
      methodsByCurrency[q.payment_currency] === q.payment_method &&
      Number.isFinite(Number(q.payable_amount)) && Number(q.payable_amount) > 0 &&
      q.valid_until && Date.parse(q.valid_until) > now &&
      result.invoices?.some(i => i.id === q.invoice_id && ['unpaid','overdue'].includes(i.status))
    );
  }


  // Display payment information and error messages.
  function msg(text, type = '') {
    const el = $('payMessage');
    if (!el) return;

    el.hidden = false;
    el.textContent = text;
    el.className = 'pay-message' + (type ? ' ' + type : '');
  }

  // Convert database invoice statuses into readable labels.
  function btnTextStatus(status) {
    return ({
      unpaid: 'Unpaid',
      receipt_submitted: 'Receipt under review',
      paid: 'Paid',
      waived: 'Waived',
      overdue: 'Overdue',
      cancelled: 'Cancelled'
    })[status] || status;
  }

  // Call a protected Supabase Edge Function.
  async function invoke(name, body) {
    if (!sb) {
      throw new Error('The payment service is not available.');
    }

    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    const token = data.session?.access_token;

    if (!token) {
      throw new Error(
        'Please sign in to access private invoices or submit a receipt.'
      );
    }

    const response = await fetch(
      `${cfg.url}/functions/v1/${name}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': cfg.anonKey,
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || 'The request failed.');
    }

    return result;
  }

  let receiptHistory = new Map();
  let historyAvailable = false;
  let programNames = new Map();
  let selectedGroup = null;
  let supportAwards=[],supportAvailable=false;
  const groups = [
    ['unpaid','Unpaid invoices','Payments requiring attention','#94610e'],
    ['pending','Pending verification','Receipts awaiting staff review','#245b9c'],
    ['paid','Paid invoices','Verified payments','#147847'],
    ['rejected','Rejected payments','Outstanding invoices with rejected evidence','#a72c37'],
    ['waived','Scholarships & Fee Waivers','Awards and fully waived invoices','#147847'],
    ['other','Other invoices','Cancelled or other statuses','#52677b']
  ];
  function category(invoice, latest) {
    if (invoice.status === 'paid') return 'paid';
    if (invoice.status === 'waived') return 'waived';
    if (invoice.status === 'receipt_submitted') return 'pending';
    if (['unpaid','overdue'].includes(invoice.status)) return latest?.status === 'rejected' ? 'rejected' : 'unpaid';
    return 'other';
  }
  async function loadDashboardData(result) {
    try{const support=await invoke('sifa-student-billing',{action:'student_support'});supportAwards=Array.isArray(support.awards)?support.awards:[];supportAvailable=true;}catch{supportAwards=[];supportAvailable=false;}
    programNames = new Map((Array.isArray(result.enrollments) ? result.enrollments : []).map(e => [e.id,e.program]));
    receiptHistory = new Map(); historyAvailable = false;
    const list = Array.isArray(result.invoices) ? result.invoices : [];
    if (!list.length) { historyAvailable = true; return; }
    const ids = new Set(list.map(i => i.id));
    try {
      const {data,error} = await sb.auth.getSession();
      if (error || !data.session || data.session.user.id !== session?.user.id) throw new Error('Session changed');
      // Existing authenticated RLS governs access. Explicit owner filter also limits staff accounts to their own receipts.
      for (let offset=0;;offset+=200) {
        const {data:rows,error:err} = await sb.from('sifa_payment_receipts')
          .select('id,invoice_id,status,submitted_at,reviewed_at,reviewer_note')
          .eq('student_user_id',data.session.user.id)
          .order('submitted_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+199);
        if (err || !Array.isArray(rows)) throw err || new Error('Receipt history unavailable');
        for (const r of rows) if (ids.has(r.invoice_id) && !receiptHistory.has(r.invoice_id)) receiptHistory.set(r.invoice_id,r);
        if (rows.length < 200) break;
      }
      historyAvailable = true;
    } catch (_) { receiptHistory.clear(); }
  }
  function element(tag,text,cls) {
    const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(cls) el.className=cls; return el;
  }
  function invoiceTitle(i) { return i.invoice_type === 'certificate_fee' ? 'Certificate fee' : i.invoice_type === 'monthly_course' ? 'Monthly course fee' : 'Invoice'; }
  function program(i) { return programNames.get(i.enrollment_id) || i.program || ''; }
  function renderCategories(host,list) {
    const grid=element('div',undefined,'billing-groups');
    const panel=element('div',undefined,'billing-records'); panel.id='billingRecords'; panel.tabIndex=-1; panel.setAttribute('role','region'); panel.setAttribute('aria-labelledby','billingRecordsTitle');
    const buttons=[];
    if (!historyAvailable) host.append(element('p','Receipt history is temporarily unavailable. Outstanding invoices remain under Unpaid; rejected payment counts cannot be confirmed. Refresh records or contact SIFA support.','billing-history-warning'));
    function show(key, reveal = false) {
      selectedGroup=key; panel.replaceChildren(); panel.hidden=!key;
      for(const [k,b] of buttons) { b.setAttribute('aria-expanded',String(k===key)); b.querySelector('.billing-view').textContent=k===key?'Close records':'View records'; }
      if (!key) return;
      const group=groups.find(g=>g[0]===key); const heading=element('h3',group[1]); heading.id='billingRecordsTitle'; panel.append(heading);
      if(key==='waived'){
        panel.append(element('h4','Scholarship awards'));
        if(!supportAvailable)panel.append(element('p','Scholarship records are temporarily unavailable. Refresh to try again.','billing-history-warning'));
        else if(!supportAwards.length)panel.append(element('p','No scholarship requests or awards recorded.','billing-empty'));
        for(const a of supportAwards){const card=element('div',undefined,'invoice');card.style.padding='16px';card.append(element('strong',a.program+' — '+a.decision),element('p',a.application_ref||''));if(a.decision==='approved')card.append(element('p',`${a.monthly_discount_percent}% monthly tuition discount · ${a.starts_on||'No start date'} to ${a.ends_on||'No end date'}`));card.append(element('p','Admission status: '+a.admission_status+'. Award approval is separate from enrollment and classroom authorization.'));panel.append(card);}
        panel.append(element('h4','Fully waived invoices'));
      }
      const rows=list.filter(i=>category(i,receiptHistory.get(i.id))===key);
      panel.append(element('p',key==='rejected'&&!historyAvailable?'Receipt history unavailable.':`${rows.length} ${rows.length===1?'invoice':'invoices'} in this category.`,'billing-result-count'));
      if (!rows.length) panel.append(element('p',key==='rejected'&&!historyAvailable?'Refresh records to try again.':'There are no records in this category.','billing-empty'));
      for(const i of rows) {
        const r=receiptHistory.get(i.id); const item=element('details',undefined,'invoice');
        const summary=element('summary'); const left=element('div'); left.append(element('strong',invoiceTitle(i)),element('small',[program(i),i.period_start+' — '+i.period_end].filter(Boolean).join(' · ')));
        const right=element('div',undefined,'billing-amount'); right.append(element('strong',`${i.amount_due} ${i.currency}`),element('small',key==='rejected'?'Receipt rejected':btnTextStatus(i.status))); summary.append(left,right);
        const detail=element('div',undefined,'billing-detail');
        detail.append(element('p',`Invoice amount: ${i.amount_due} ${i.currency} · Due date: ${i.due_date || 'Not specified'}`),element('p',`Invoice status: ${btnTextStatus(i.status)}`));
        if (r) { detail.append(element('p',`Latest receipt: ${r.status.replaceAll('_',' ')}${r.reviewed_at?' · Reviewed '+new Date(r.reviewed_at).toLocaleString():''}`)); if(r.status==='rejected' && r.reviewer_note) detail.append(element('p','Review reason: '+r.reviewer_note)); }
        if (['unpaid','overdue'].includes(i.status)) {
          detail.append(element('h4','Payment methods and approved amounts'),element('p','Cross-currency transfers require an approved SIFA quote. Submit only evidence of an actual payment; do not pay again solely because a receipt was rejected.'));
          for (const [currency,method] of Object.entries(methodsByCurrency)) {
            const q=approvedQuotes.find(q=>q.invoice_id===i.id && q.payment_currency===currency && Date.parse(q.valid_until)>Date.now());
            detail.append(element('p',q?`${method} (${currency}): ${q.payable_amount} ${currency} approved until ${new Date(q.valid_until).toLocaleString()}.`:currency===i.currency?`${method}: ${i.amount_due} ${currency} (invoice amount).`:`${method}: request an approved amount from SIFA before transferring.`));
          }
          const action=element('button',key==='rejected'?'Submit corrected receipt':'Submit payment receipt','btn btn-primary'); action.type='button'; action.addEventListener('click',()=>{const s=$('invoiceSelect'); s.value=i.id; s.dispatchEvent(new Event('change')); $('receiptCard').hidden=false; $('receiptCard').scrollIntoView({block:'start',behavior:'smooth'});}); detail.append(action);
        }
        item.append(summary,detail); panel.append(item);
      }
      const back=element('button','Back to payment categories','btn btn-secondary billing-back'); back.type='button'; back.addEventListener('click',()=>{const button=buttons.find(([k])=>k===key)?.[1]; show(null); button?.focus();}); panel.append(back);
      if (reveal) { panel.focus({preventScroll:true}); panel.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); }
    }
    for(const [key,name,desc,color] of groups) {
      const count=list.filter(i=>category(i,receiptHistory.get(i.id))===key).length;
      if(key==='other' && !count) continue;
      const b=element('button',undefined,'billing-group'); b.type='button'; b.style.setProperty('--accent',color); b.setAttribute('aria-controls','billingRecords');
      b.append(element('span',key==='rejected'&&!historyAvailable?'—':(key==='waived' ? `${supportAvailable?supportAwards.filter(a=>a.decision==='approved').length:'—'} awards · ${count} invoices` : String(count)),'billing-count'),element('strong',name),element('small',desc),element('span','View records','billing-view')); b.addEventListener('click',()=>show(selectedGroup===key?null:key,true)); buttons.push([key,b]); grid.append(b);
    }
    host.append(grid,panel); show(buttons.some(([k])=>k===selectedGroup)?selectedGroup:null);
  }

  // Display invoices belonging to the signed-in student.
  function render(list) {
    invoices = list;

    const host = $('invoiceList');
    const select = $('invoiceSelect');
    const invoiceCard = $('invoiceCard');
    const receiptCard = $('receiptCard');

    if (!host || !select || !invoiceCard || !receiptCard) {
      throw new Error('The payment page is missing required elements.');
    }

    host.replaceChildren();
    select.replaceChildren();

    invoiceCard.hidden = false;

    renderCategories(host,list);
    for (const invoice of list) {
      if (['unpaid','overdue'].includes(invoice.status)) {
        const option=document.createElement('option'); option.value=invoice.id;
        option.textContent=[invoiceTitle(invoice),program(invoice),invoice.period_start,`${invoice.amount_due} ${invoice.currency}`,btnTextStatus(invoice.status)].filter(Boolean).join(' · ');
        select.append(option);
      }
    }

    receiptCard.hidden = true;
    const currencySelect = document.querySelector('#receiptForm select[name="claimed_currency"]');
    const methodSelect = document.querySelector('#receiptForm select[name="payment_method"]');
    const amountInput = document.querySelector('#receiptForm input[name="claimed_amount"]');
    let quoteSelect = document.getElementById('approvedPaymentChoice');
    if (!quoteSelect) {
      const label = document.createElement('label');
      label.textContent = 'Choose an approved payment option';
      quoteSelect = document.createElement('select');
      quoteSelect.id = 'approvedPaymentChoice';
      quoteSelect.name = 'payment_quote_id';
      quoteSelect.required = true;
      label.append(quoteSelect);
      const invoiceField = select.closest('label');
      invoiceField?.insertAdjacentElement('afterend', label);
    }
    function updatePaymentOptions() {
      const invoice = invoices.find(x => x.id === select.value);
      quoteSelect.replaceChildren();
      if (!invoice) return;
      const options = approvedQuotes.filter(q => q.invoice_id === invoice.id);
      const choices = [];
      // Invoice-currency transfers continue using the existing secure v2 path.
      choices.push({id: '', currency: invoice.currency, method: methodsByCurrency[invoice.currency], amount: Number(invoice.amount_due)});
      // Cross-currency transfers require a live staff-approved quote.
      for (const q of options) {
        if (q.payment_currency !== invoice.currency) {
          choices.push({id: q.id, currency: q.payment_currency, method: q.payment_method, amount: Number(q.payable_amount)});
        }
      }
      for (const choice of choices) {
        const option = document.createElement('option');
        option.value = choice.id || 'invoice';
        option.textContent = `${choice.method} — ${choice.amount} ${choice.currency}`;
        quoteSelect.append(option);
      }
      const apply = () => {
        const c = choices.find(x => (x.id || 'invoice') === quoteSelect.value);
        if (!c) return;
        currencySelect.value = c.currency;
        methodSelect.value = c.method;
        amountInput.value = String(c.amount);
      };
      quoteSelect.onchange = apply;
      apply();
    }
    for (const field of [currencySelect, methodSelect, amountInput]) {
      if (field) { field.style.pointerEvents = 'none'; field.tabIndex = -1; field.setAttribute('aria-readonly', 'true'); }
    }
    select.onchange = updatePaymentOptions;
    updatePaymentOptions();

  }

  // Convert a selected receipt file into Base64.
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onerror = () => {
        reject(new Error('Could not read receipt file.'));
      };

      reader.onload = () => {
        resolve(String(reader.result).split(',')[1] || '');
      };

      reader.readAsDataURL(file);
    });
  }

  // Initialize the private student payment area.
  async function init() {
    const invoiceCard = $('invoiceCard');
    const receiptCard = $('receiptCard');

    if (invoiceCard) invoiceCard.hidden = true;
    if (receiptCard) receiptCard.hidden = true;

    msg('Checking your student account and loading invoices...');

    // Check Supabase configuration.
    if (!window.supabase || !cfg.url || !cfg.anonKey) {
      msg(
        'The SIFA payment service is not configured. ' +
        'Please contact SIFA support.',
        'error'
      );
      return;
    }

    try {
    
sb = window.supabase.createClient(
  cfg.url,
  cfg.anonKey,
  window.SIFA_AUTH_OPTIONS
);


      // Check whether the student is signed in.
      const { data, error } = await sb.auth.getSession();

      if (error) throw error;

      session = data.session;

      if (!session) {
        msg(
          'Please sign in to your SIFA Student Portal ' +
          'to view private invoices and submit payment receipts.'
        );
        return;
      }

      void window.SIFALoadPhoto?.(sb,cfg,session.user.id);
      // Load private invoices from the billing API.
      const result = await invoke(
        'sifa-student-billing',
        {
          action: 'list_invoices'
        }
      );

      const studentInvoices = result.invoices || [];
      loadQuotes(result);
      await loadDashboardData(result);
      render(studentInvoices);

      // Show an explanation when no invoices exist.
      if (!studentInvoices.length) {
        msg(
          'No invoices have been issued to your account yet. ' +
          'Contact SIFA support if you expect an invoice.'
        );
        return;
      }

      msg(
        'Your private invoices have loaded successfully.',
        'success'
      );

    } catch (error) {
      console.error('SIFA payment loading error:', error);

      if (invoiceCard) invoiceCard.hidden = true;
      if (receiptCard) receiptCard.hidden = true;

      msg(
        error?.message ||
        'Unable to load your invoices. ' +
        'Please try again or contact SIFA support.',
        'error'
      );
    }
  }

  // Handle student payment receipt submissions.
  $('receiptForm')?.addEventListener('submit', async event => {
    event.preventDefault();

    const form = event.currentTarget;

    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const file = formData.get('receipt');

    // Validate the selected receipt file.
    if (!(file instanceof File) || !file.size) {
      return msg('Choose a receipt file.', 'error');
    }

    if (file.size > 5 * 1024 * 1024) {
      return msg(
        'Receipt must be 5 MB or smaller.',
        'error'
      );
    }

    // Find the invoice selected by the student.
    const invoice = invoices.find(
      item => item.id === formData.get('invoice_id')
    );

    if (!invoice || !["unpaid","overdue"].includes(invoice.status)) {
      return msg('Choose a valid invoice.', 'error');
    }

    const selectedQuoteId = String(formData.get('payment_quote_id') || 'invoice');
    const selectedQuote = selectedQuoteId === 'invoice' ? null : approvedQuotes.find(q =>
      q.id === selectedQuoteId && q.invoice_id === invoice.id && q.valid_until && Date.parse(q.valid_until) > Date.now()
    );
    if (selectedQuoteId !== 'invoice' && !selectedQuote) return msg('Approved payment quote expired or unavailable. Refresh the page.', 'error');
    const expectedCurrency = selectedQuote?.payment_currency || invoice.currency;
    const expectedMethod = selectedQuote?.payment_method || methodsByCurrency[invoice.currency];
    const expectedAmount = Number(selectedQuote?.payable_amount ?? invoice.amount_due);
    if (formData.get('claimed_currency') !== expectedCurrency ||
        formData.get('payment_method') !== expectedMethod ||
        Number(formData.get('claimed_amount')) !== expectedAmount) {
      return msg('Payment details must match the approved payment option.', 'error');
    }

    const button = $('receiptSubmit');

    if (button) {
      button.disabled = true;
      button.textContent = 'Uploading securely…';
    }

    try {
      // Read and prepare the receipt.
      const base64 = await fileToBase64(file);

      // Submit receipt to the protected backend.
      const result = await invoke(
        'submit-payment-receipt',
        {
          invoice_id: invoice.id,
          payment_quote_id: selectedQuote?.id || null,
          payment_method: formData.get('payment_method'),
          claimed_amount: Number(
            formData.get('claimed_amount')
          ),
          claimed_currency: formData.get('claimed_currency'),
          
transaction_reference: formData.get('transaction_reference'),
sender_full_name: String(formData.get('sender_full_name') || '').trim(),
sender_contact: String(formData.get('sender_contact') || '').trim(),
sender_relationship: String(formData.get('sender_relationship') || ''),

          name: file.name,
          type: file.type,
          base64
        }
      );

      msg(
        result.message || 'Receipt submitted for review.',
        'success'
      );

      form.reset();

      // Refresh invoice statuses after submission.
      const refreshed = await invoke(
        'sifa-student-billing',
        {
          action: 'list_invoices'
        }
      );

      loadQuotes(refreshed);
      await loadDashboardData(refreshed);
      selectedGroup = "pending";
      render(refreshed.invoices || []);

    } catch (error) {
      msg(
        error.message || 'Receipt submission failed.',
        'error'
      );

    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Submit receipt for review';
      }
    }
  });

  $("billingRefresh")?.addEventListener("click",()=>{ if ($("receiptCard").hidden || window.confirm("Refresh records? Unsaved receipt form details will be cleared.")) location.reload(); });

  // Start the payment system.
  init();
})();
