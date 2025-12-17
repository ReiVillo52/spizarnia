/***********************
 * KONFIGURACJA
 ***********************/
const SUPABASE_URL = 'https://eefntqtpekdepwecfdvq.supabase.co';
const SUPABASE_KEY = 'sb_publishable__TvITuQi1DiPpief1bAV4w_MHJlBHuQ';

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

let pantryCache = [];
let processing = false;
let scannerStarted = false;

/***********************
 * FEEDBACK – ZAWSZE WIDOCZNY NA TELEFONIE
 ***********************/
function showFeedback(text, error = false) {
  const box = document.getElementById('scanFeedback');
  if (!box) return;

  box.textContent = text;
  box.style.position = 'fixed';
  box.style.top = '40%';
  box.style.left = '50%';
  box.style.transform = 'translate(-50%, -50%)';
  box.style.padding = '20px 30px';
  box.style.fontSize = '20px';
  box.style.fontWeight = '700';
  box.style.borderRadius = '12px';
  box.style.zIndex = '9999';
  box.style.background = error ? '#e74c3c' : '#2ecc71';
  box.style.color = '#fff';
  box.style.display = 'block';

  setTimeout(() => {
    box.style.display = 'none';
  }, 1000);
}

/***********************
 * DODAWANIE PRODUKTU
 ***********************/
async function addByBarcode(barcode) {
  if (!barcode) return;

  // 1️⃣ products
  let { data: product } = await supabaseClient
    .from('products')
    .select('*')
    .eq('barcode', barcode)
    .single();

  // 2️⃣ OpenFoodFacts
  if (!product) {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`
    );
    const json = await res.json();

    const name =
      json.product?.product_name ||
      json.product?.product_name_pl ||
      'Nieznany produkt';

    const brand = json.product?.brands || '';
    const category =
      json.product?.categories_tags?.[0]?.replace('pl:', '') || '';

    const insert = await supabaseClient
      .from('products')
      .insert({ barcode, name, brand, category })
      .select()
      .single();

    product = insert.data;
  }

  // 3️⃣ pantry
  let { data: pantryItem } = await supabaseClient
    .from('pantry')
    .select('*')
    .eq('product_id', product.id)
    .single();

  if (pantryItem) {
    await supabaseClient
      .from('pantry')
      .update({ quantity: pantryItem.quantity + 1 })
      .eq('id', pantryItem.id);
  } else {
    await supabaseClient.from('pantry').insert({
      product_id: product.id,
      quantity: 1,
      location: 'spiżarnia'
    });
  }

  loadPantry();
  showFeedback(`Dodano: ${product.name}`);
}

/***********************
 * WCZYTYWANIE + LISTA (KLIK PALCEM)
 ***********************/
async function loadPantry() {
  const { data } = await supabaseClient
    .from('pantry')
    .select(`
      id,
      quantity,
      products (
        name
      )
    `)
    .order('added_at', { ascending: false });

  pantryCache = data || [];
  renderList(pantryCache);
}

function renderList(items) {
  const list = document.getElementById('list');
  list.innerHTML = '';

  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'item';
    li.textContent = `${item.products.name} x${item.quantity}`;
    li.style.padding = '12px';
    li.style.borderBottom = '1px solid #ccc';

    li.addEventListener('click', () => {
      const taken = li.style.opacity === '0.4';
      li.style.opacity = taken ? '1' : '0.4';
      li.style.textDecoration = taken ? 'none' : 'line-through';
    });

    list.appendChild(li);
  });
}

/***********************
 * WYSZUKIWARKA
 ***********************/
function filterList() {
  const q = document.getElementById('search').value.toLowerCase();
  renderList(
    pantryCache.filter(item =>
      item.products.name.toLowerCase().includes(q)
    )
  );
}

/***********************
 * RĘCZNE DODAWANIE
 ***********************/
function manualAdd() {
  const input = document.getElementById('manualBarcode');
  const code = input.value.trim();
  if (!code) return;

  addByBarcode(code);
  input.value = '';
}

/***********************
 * SKANER – START DOPIERO PO KLIKNIĘCIU
 ***********************/
function startScanner() {
  if (scannerStarted) return;
  scannerStarted = true;

  Quagga.init({
    inputStream: {
      type: 'LiveStream',
      target: document.querySelector('#scanner'),
      constraints: { facingMode: 'environment' }
    },
    decoder: {
      readers: ['ean_reader', 'ean_8_reader']
    }
  }, err => {
    if (err) {
      alert('Błąd kamery');
      console.error(err);
      return;
    }
    Quagga.start();
    showFeedback('Skaner uruchomiony');
  });
}

Quagga.onDetected(async data => {
  if (processing) return;
  processing = true;

  const code = data.codeResult.code;

  showFeedback(`Zeskanowano: ${code}`);

  try {
    await addByBarcode(code);
  } catch (e) {
    showFeedback('Błąd skanowania', true);
    console.error(e);
  }

  // ⏳ DELAY PO SKANIE (3 sekundy)
  setTimeout(() => {
    processing = false;
  }, 3000);
});

/***********************
 * START
 ***********************/
loadPantry();

document.getElementById('startApp').addEventListener('click', startScanner);
