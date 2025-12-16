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


function showFeedback(text) {
  const box = document.getElementById('scanFeedback');
  const beep = document.getElementById('beep');

  box.textContent = text;
  box.classList.add('show');

  if (navigator.vibrate) navigator.vibrate(100);
  if (beep) beep.play();

  setTimeout(() => {
    box.classList.remove('show');
  }, 600);
}


/***********************
 * DODAWANIE PRODUKTU
 ***********************/
async function addByBarcode(barcode) {
  if (!barcode) return;

  console.log('Dodaję produkt:', barcode);

  // 1️⃣ sprawdź product
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
 * WCZYTYWANIE + RENDER
 ***********************/
async function loadPantry() {
  const { data } = await supabaseClient
    .from('pantry')
    .select(`
      id,
      quantity,
      products (
        name,
        brand
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
    li.innerHTML = `
      <span class="name">${item.products.name}</span>
      
      <span class="qty">x${item.quantity}</span>
    `;
    list.appendChild(li);
  });
}
//<span class="brand">${item.products.brand || ''}</span>


/***********************
 * WYSZUKIWARKA
 ***********************/
function filterList() {
  const q = document.getElementById('search').value.toLowerCase();

  const filtered = pantryCache.filter(item =>
    item.products.name.toLowerCase().includes(q)
  );

  renderList(filtered);
}

/***********************
 * RĘCZNE WPISYWANIE
 ***********************/
function manualAdd() {
  const input = document.getElementById('manualBarcode');
  const code = input.value.trim();
  if (!code) return;

  addByBarcode(code);
  input.value = '';
}

/***********************
 * SKANER (QUAGGA)
 ***********************/
Quagga.init({
  inputStream: {
    type: "LiveStream",
    target: document.querySelector("#scanner"),
    constraints: { facingMode: "environment" }
  },
  decoder: {
    readers: ["ean_reader", "ean_8_reader"]
  }
}, err => {
  if (err) {
    console.error("Quagga init error:", err);
    return;
  }
  Quagga.start();
});

Quagga.onDetected(async data => {
  if (processing) return;
  processing = true;

  const code = data.codeResult.code;
  console.log("Zeskanowano:", code);

  try {
    await addByBarcode(code);
  } catch (e) {
    console.error("Błąd:", e);
  }

  setTimeout(() => {
    processing = false;
  }, 1200);
});


/***********************
 * START
 ***********************/
loadPantry();

