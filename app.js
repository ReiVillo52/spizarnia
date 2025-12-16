/***********************
 * KONFIGURACJA
 ***********************/
const SUPABASE_URL = 'https://eefntqtpekdepwecfdvq.supabase.co';
const SUPABASE_KEY = 'sb_secret_0ia2m5vbeLJrygGO64-q9Q_aGaBWrzs';

const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

/***********************
 * DODAWANIE PRODUKTU
 ***********************/
async function addByBarcode(barcode) {
  if (!barcode) return;

  console.log('Skan:', barcode);

  // 1️⃣ sprawdź produkt w products
  let { data: product, error } = await supabaseClient
    .from('products')
    .select('*')
    .eq('barcode', barcode)
    .single();

  // 2️⃣ jeśli nie ma — OpenFoodFacts
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
      .insert({
        barcode,
        name,
        brand,
        category
      })
      .select()
      .single();

    product = insert.data;
  }

  // 3️⃣ sprawdź czy jest już w pantry
  let { data: pantryItem } = await supabaseClient
    .from('pantry')
    .select('*')
    .eq('product_id', product.id)
    .single();

  if (pantryItem) {
    // zwiększ ilość
    await supabaseClient
      .from('pantry')
      .update({ quantity: pantryItem.quantity + 1 })
      .eq('id', pantryItem.id);
  } else {
    // dodaj nowy
    await supabaseClient.from('pantry').insert({
      product_id: product.id,
      quantity: 1,
      location: 'spiżarnia'
    });
  }

  loadPantry();
}

/***********************
 * WCZYTYWANIE SPIŻARNI
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

  const list = document.getElementById('list');
  list.innerHTML = '';

  data.forEach(item => {
    const li = document.createElement('li');
    li.textContent = `${item.products.name} (${item.products.brand}) x${item.quantity}`;
    list.appendChild(li);
  });
}

/***********************
 * SKANER (QUAGGA)
 ***********************/
let lastCode = null;

Quagga.init(
  {
    inputStream: {
      name: 'Live',
      type: 'LiveStream',
      target: document.querySelector('#scanner'),
      constraints: {
        facingMode: 'environment'
      }
    },
    decoder: {
      readers: ['ean_reader', 'ean_8_reader']
    }
  },
  err => {
    if (err) {
      console.error(err);
      return;
    }
    Quagga.start();
  }
);

Quagga.onDetected(async data => {
  const code = data.codeResult.code;

  // blokada podwójnego skanu
  if (code === lastCode) return;
  lastCode = code;

  Quagga.stop();
  await addByBarcode(code);

  setTimeout(() => {
    lastCode = null;
    Quagga.start();
  }, 1500);
});

/***********************
 * START
 ***********************/
loadPantry();
