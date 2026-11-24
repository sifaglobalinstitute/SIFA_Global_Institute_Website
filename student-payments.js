
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

    if (!list.length) {
      host.textContent =
        'No invoices are currently available for your account. ' +
        'Contact SIFA support if you expect an invoice.';

      receiptCard.hidden = true;
      return;
    }

    for (const invoice of list) {
      const article = document.createElement('article');
      article.className = 'invoice';

      const title = document.createElement('h3');

      title.textContent =
        (invoice.invoice_type === 'certificate_fee'
          ? 'Certificate fee'
          : 'Monthly course fee') +
        ` · ${invoice.period_start} — ${invoice.period_end}`;

      const description = document.createElement('p');

      description.textContent =
        `Amount due: ${invoice.amount_due} ${invoice.currency}` +
        ` · Due: ${invoice.due_date}` +
        ` · Status: ${btnTextStatus(invoice.status)}`;

      article.append(title, description);

      if (['unpaid', 'overdue'].includes(invoice.status)) {
        const heading = document.createElement('h4');
        heading.textContent = 'Payment methods and approved amounts';
        article.append(heading);
        const info = document.createElement('p');
        info.textContent = 'Choose the payment route suitable for you. Cross-currency transfers require an approved SIFA quote; a receipt does not confirm payment.';
        article.append(info);
        for (const [currency, method] of Object.entries(methodsByCurrency)) {
          const q = approvedQuotes.find(q => q.invoice_id === invoice.id && q.payment_currency === currency);
          const line = document.createElement('p');
          line.className = 'small';
          if (q) {
            line.textContent = `${method} (${currency}): ${q.payable_amount} ${currency} approved until ${new Date(q.valid_until).toLocaleString()}.`;
          } else if (currency === invoice.currency) {
            line.textContent = `${method} (${currency}): ${invoice.amount_due} ${currency} (invoice amount).`;
          } else {
            line.textContent = `${method} (${currency}): request an approved amount from SIFA before transferring.`;
          }
          article.append(line);
        }
      }
      host.append(article);

      // Only eligible invoices can receive new payment receipts.
      if (
        ![
          'paid',
          'waived',
          'cancelled',
          'receipt_submitted'
        ].includes(invoice.status)
      ) {
        const option = document.createElement('option');

        option.value = invoice.id;

        option.textContent =
          `${invoice.period_start} · ` +
          `${invoice.amount_due} ${invoice.currency} · ` +
          btnTextStatus(invoice.status);

        select.append(option);
      }
    }


    receiptCard.hidden = !select.options.length;
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

      // Load private invoices from the billing API.
      const result = await invoke(
        'sifa-student-billing',
        {
          action: 'list_invoices'
        }
      );

      const studentInvoices = result.invoices || [];
      loadQuotes(result);
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

    if (!invoice) {
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

  // Start the payment system.
  init();
})();
