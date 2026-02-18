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
 * NORMALIZACJA KODU KRESKOWEGO
 ***********************/
function normalizeBarcode(code) {
  if (!code) return '';
  
  // Usuń białe znaki i inne znaki specjalne
  code = code.trim().replace(/\s+/g, '');
  
  // Usuń znaki niebędące cyframi (dla kodów EAN)
  code = code.replace(/[^0-9]/g, '');
  
  // Dla kodów EAN-13: upewnij się, że ma 13 cyfr (dodaj zera z przodu jeśli brakuje)
  if (code.length > 0 && code.length < 13) {
    code = code.padStart(13, '0');
  }
  
  return code;
}

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

  // NORMALIZUJ KOD PRZED UŻYCIEM
  barcode = normalizeBarcode(barcode);
  
  if (!barcode) {
    showFeedback('Nieprawidłowy kod', true);
    return;
  }

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
 * EDYCJA NAZWY PRODUKTU
 ***********************/
// MUSI BYĆ GLOBALNA
window.editProductName = function(productId, currentName) {
  openModal({
    title: '✏️ Edytuj nazwę',
    body: `
      <div style="margin-bottom: 15px;">Obecna nazwa: <span class="modal-product-name">${currentName}</span></div>
      <input type="text" id="editNameInput" value="${currentName}" 
             style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.95rem; font-family: 'DM Sans', sans-serif;" 
             placeholder="Nowa nazwa produktu">
    `,
    actions: [
      { label: 'Anuluj', cls: 'cancel', fn: () => {} },
      { label: 'Zapisz', cls: 'confirm-add', fn: async () => {
        const input = document.getElementById('editNameInput');
        const newName = input?.value?.trim();
        
        if (!newName || newName === currentName) {
          return;
        }
        
        try {
          // Aktualizuj w bazie products
          const { error } = await supabaseClient
            .from('products')
            .update({ name: newName })
            .eq('id', productId);
          
          if (error) throw error;
          
          // Odśwież listę
          await loadPantry();
          showFeedback(`✓ Zmieniono: ${newName}`);
        } catch (error) {
          console.error('Błąd edycji:', error);
          showFeedback('Błąd zmiany nazwy', true);
        }
      }}
    ]
  });
  
  // Autofocus na input po otwarciu modalu
  setTimeout(() => {
    const input = document.getElementById('editNameInput');
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
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
      taken,
      product_id,
      products (
        id,
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

    // jeśli już wzięte, ustaw style
    if(item.taken){
      li.style.opacity = '0.4';
      li.style.textDecoration = 'line-through';
    }

    li.addEventListener('click', async () => {
      const newTaken = !item.taken;
      item.taken = newTaken;

      // od razu update w Supabase
      await supabaseClient
        .from('pantry')
        .update({ taken: newTaken })
        .eq('id', item.id);

      // update front-end
      li.style.opacity = newTaken ? '0.4' : '1';
      li.style.textDecoration = newTaken ? 'line-through' : 'none';
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