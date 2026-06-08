// Конфигурация языков
const languageConfig = {
    chinese: {
        placeholder: 'Введите иероглиф или предложение...',
        wordsLabel: 'Иероглифы',
        notFound: 'Иероглифы не найдены. Попробуйте другое фото или ручной ввод',
        processing: 'Распознавание иероглифов...',
        waiting: '⏳ Подождите, идёт распознавание иероглифов в другой вкладке...'
    },
    english: {
        placeholder: 'Введите слово или предложение...',
        wordsLabel: 'Слова',
        notFound: 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        processing: 'Распознавание слов...',
        waiting: '⏳ Подождите, идёт распознавание слов в другой вкладке...'
    },
    russian: {
        placeholder: 'Введите слово или предложение...',
        wordsLabel: 'Слова',
        notFound: 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        processing: 'Распознавание слов...',
        waiting: '⏳ Подождите, идёт распознавание слов в другой вкладке...'
    }
};

let currentLanguage = 'chinese';
let currentDeck = [];
let reviewCards = [];
let currentCardIndex = 0;
let isReviewActive = false;

// Данные для каждой вкладки языка
let manualAddedWordsByLang = {
    chinese: [],
    english: [],
    russian: []
};

// Хранилище результатов OCR для каждого языка
let ocrResultsByLang = {
    chinese: null,
    english: null,
    russian: null
};

// Хранилище превью для каждого языка
let previewsByLang = {
    chinese: null,
    english: null,
    russian: null
};

// Текущий активный OCR процесс
let activeOcrLanguage = null;

// Показать уведомление
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Обновление UI при смене языка
function updateLanguageUI() {
    const config = languageConfig[currentLanguage];
    const manualInput = document.getElementById('manualWord');
    if (manualInput) manualInput.placeholder = config.placeholder;
    const resultsTitle = document.getElementById('resultsTitle');
    if (resultsTitle) resultsTitle.textContent = config.wordsLabel;
    
    updateTempAddedDisplay();
    updateOCRDisplayForCurrentLanguage();
}

// Обновление отображения OCR для текущего языка
function updateOCRDisplayForCurrentLanguage() {
    const resultsSection = document.getElementById('resultsSection');
    const wordsGrid = document.getElementById('wordsGrid');
    const dropZone = document.getElementById('dropZone');
    const previewContainer = document.getElementById('previewContainer');
    const previewImg = document.getElementById('previewImg');
    
    // Восстанавливаем превью если было
    if (previewsByLang[currentLanguage]) {
        previewImg.src = previewsByLang[currentLanguage];
        dropZone.classList.add('with-preview');
        previewContainer.style.display = 'block';
    } else {
        dropZone.classList.remove('with-preview');
        previewContainer.style.display = 'none';
        previewImg.src = '';
    }
    
    // Показываем результаты если есть
    if (ocrResultsByLang[currentLanguage] && ocrResultsByLang[currentLanguage].words) {
        resultsSection.style.display = 'block';
        displayResults(ocrResultsByLang[currentLanguage].words);
    } else if (activeOcrLanguage && activeOcrLanguage !== currentLanguage) {
        // Распознавание идёт в другой вкладке
        resultsSection.style.display = 'block';
        const waitingConfig = languageConfig[currentLanguage];
        wordsGrid.innerHTML = `<div style="text-align: center; padding: 40px; color: #888;">${waitingConfig.waiting}</div>`;
    } else if (!ocrResultsByLang[currentLanguage]) {
        resultsSection.style.display = 'none';
    }
}

// Переключение языка
document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentLanguage = btn.dataset.lang;
        updateLanguageUI();
        await loadDeck();
        if (isReviewActive) {
            isReviewActive = false;
            document.getElementById('reviewCard').style.display = 'none';
            document.getElementById('reviewContainer').style.display = 'flex';
        }
    });
});

// Переключение вкладок
function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`${tabId}-tab`).classList.add('active');
    
    if (tabId !== 'review' && isReviewActive) {
        isReviewActive = false;
        document.getElementById('reviewCard').style.display = 'none';
        document.getElementById('reviewContainer').style.display = 'flex';
    }
    
    if (tabId === 'deck') loadDeck();
    if (tabId === 'manual') updateTempAddedDisplay();
    if (tabId === 'upload') updateOCRDisplayForCurrentLanguage();
}

// Загрузка колоды для текущего языка
async function loadDeck() {
    const response = await fetch(`/api/deck/${currentLanguage}`);
    currentDeck = await response.json();
    updateDeckUI();
}

function updateDeckUI() {
    const container = document.getElementById('deckGrid');
    if (!container) return;
    if (currentDeck.length === 0) {
        container.innerHTML = '<div class="empty-deck">📭 Нет слов. Добавьте слова через OCR или ручной ввод</div>';
        document.getElementById('deckStats').textContent = '0 слов';
        return;
    }
    container.innerHTML = currentDeck.map(item => `
        <div class="deck-item">
            <div class="deck-word">${escapeHtml(item.word)}</div>
            <div class="deck-translation">${escapeHtml(item.translation || '')}</div>
            <button class="delete-word" onclick="deleteWord('${escapeHtml(item.word)}')">✖</button>
        </div>
    `).join('');
    document.getElementById('deckStats').textContent = `${currentDeck.length} слов`;
}

async function deleteWord(word) {
    await fetch(`/api/deck/${currentLanguage}/${encodeURIComponent(word)}`, { method: 'DELETE' });
    await loadDeck();
}

async function clearDeck() {
    if (confirm('Удалить все слова из колоды?')) {
        await fetch(`/api/deck/${currentLanguage}`, { method: 'DELETE' });
        await loadDeck();
    }
}

// Показываем превью и сохраняем для текущего языка
function showPreviewForLanguage(imageBase64, language) {
    previewsByLang[language] = imageBase64;
    
    if (currentLanguage === language) {
        const dropZone = document.getElementById('dropZone');
        const previewImg = document.getElementById('previewImg');
        const previewContainer = document.getElementById('previewContainer');
        
        previewImg.src = imageBase64;
        dropZone.classList.add('with-preview');
        previewContainer.style.display = 'block';
    }
}

function clearPreviewForLanguage(language) {
    previewsByLang[language] = null;
    ocrResultsByLang[language] = null;
    
    if (currentLanguage === language) {
        const dropZone = document.getElementById('dropZone');
        const previewContainer = document.getElementById('previewContainer');
        const fileInput = document.getElementById('fileInput');
        
        dropZone.classList.remove('with-preview');
        previewContainer.style.display = 'none';
        previewContainer.querySelector('img').src = '';
        fileInput.value = '';
        document.getElementById('resultsSection').style.display = 'none';
    }
}

function clearPreview() {
    clearPreviewForLanguage(currentLanguage);
}

// Разбивка текста на отдельные иероглифы для китайского
function splitChineseText(text) {
    const lines = text.split('\n');
    const result = [];
    const seen = new Set();
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Если строка состоит только из китайских иероглифов
        if (/^[\u4e00-\u9fff]+$/.test(trimmed)) {
            if (trimmed.length === 1) {
                // Один иероглиф
                if (!seen.has(trimmed)) {
                    seen.add(trimmed);
                    result.push(trimmed);
                }
            } else {
                // Строка из нескольких иероглифов - разбиваем
                for (const char of trimmed) {
                    if (!seen.has(char)) {
                        seen.add(char);
                        result.push(char);
                    }
                }
            }
        }
    }
    
    return result;
}

// Drag & Drop и загрузка
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

if (dropZone) {
    dropZone.addEventListener('click', (e) => {
        if (!e.target.closest('.remove-preview-btn')) {
            fileInput.click();
        }
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) await processImage(file);
    });
}
if (fileInput) {
    fileInput.addEventListener('change', async (e) => { if (e.target.files[0]) await processImage(e.target.files[0]); });
}

document.getElementById('clipboardBtn')?.addEventListener('click', async () => {
    try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
            const imageTypes = item.types.filter(type => type.startsWith('image/'));
            if (imageTypes.length > 0) {
                const blob = await item.getType(imageTypes[0]);
                const file = new File([blob], 'clipboard.png', { type: blob.type });
                await processImage(file);
                return;
            }
        }
        showToast('В буфере обмена нет изображения');
    } catch (err) {
        showToast('Не удалось получить изображение из буфера обмена');
    }
});

async function processImage(file) {
    // Определяем язык, из которого загружено фото
    const ocrLanguage = currentLanguage;
    
    // Сразу показываем превью
    const reader = new FileReader();
    reader.onload = (e) => {
        showPreviewForLanguage(e.target.result, ocrLanguage);
    };
    reader.readAsDataURL(file);
    
    // Очищаем старые результаты для этого языка
    ocrResultsByLang[ocrLanguage] = null;
    
    // Если текущий язык совпадает с языком загрузки, показываем индикатор
    if (currentLanguage === ocrLanguage) {
        const resultsSection = document.getElementById('resultsSection');
        const wordsGrid = document.getElementById('wordsGrid');
        const config = languageConfig[ocrLanguage];
        
        resultsSection.style.display = 'block';
        wordsGrid.innerHTML = `<div style="text-align: center; padding: 40px;">${config.processing}</div>`;
    }
    
    // Устанавливаем активный OCR процесс
    activeOcrLanguage = ocrLanguage;
    
    const formData = new FormData();
    formData.append('image', file);
    formData.append('language', ocrLanguage);

    try {
        const response = await fetch('/api/ocr', { method: 'POST', body: formData });
        const data = await response.json();

        if (data.error) {
            if (currentLanguage === ocrLanguage) {
                document.getElementById('wordsGrid').innerHTML = `<div style="text-align: center; padding: 40px; color: #888;">❌ Ошибка: ${data.error}<br><br>Проверьте файл ollama_debug.log</div>`;
            }
        } else if (data.words && data.words.length > 0) {
            // Сохраняем результаты для этого языка
            ocrResultsByLang[ocrLanguage] = { words: data.words };
            
            // Если текущий язык совпадает с языком загрузки, показываем результаты
            if (currentLanguage === ocrLanguage) {
                displayResults(data.words);
            }
        } else {
            // Сохраняем пустой результат
            ocrResultsByLang[ocrLanguage] = { words: [] };
            
            if (currentLanguage === ocrLanguage) {
                const config = languageConfig[ocrLanguage];
                document.getElementById('wordsGrid').innerHTML = `<div style="text-align: center; padding: 40px; color: #888;">${config.notFound}</div>`;
            }
        }
    } catch (error) {
        if (currentLanguage === ocrLanguage) {
            document.getElementById('wordsGrid').innerHTML = `<div style="text-align: center; padding: 40px; color: #888;">❌ Ошибка соединения. Проверьте, запущен ли сервер.</div>`;
        }
    } finally {
        if (activeOcrLanguage === ocrLanguage) {
            activeOcrLanguage = null;
        }
        // Если есть результаты для этого языка и он не текущий, просто сохраняем
        if (currentLanguage !== ocrLanguage && ocrResultsByLang[ocrLanguage]) {
            // Ничего не делаем, просто сохранили
            console.log(`Результаты для ${ocrLanguage} сохранены`);
        }
    }
}

function displayResults(words) {
    const container = document.getElementById('wordsGrid');
    document.getElementById('resultsStats').textContent = `${words.length} слов`;
    
    container.innerHTML = words.map(word => `
        <div class="word-card">
            <div class="word-text">${escapeHtml(word.word)}</div>
            <div class="word-translation">${escapeHtml(word.translation || '')}</div>
            <button class="add-btn" data-word="${escapeHtml(word.word)}" data-translation="${escapeHtml(word.translation || '')}" onclick="addToDeckAndRefresh(this, '${escapeHtml(word.word)}', '${escapeHtml(word.translation || '')}')">➕ Добавить</button>
        </div>
    `).join('');
    
    for (const item of currentDeck) {
        const btn = document.querySelector(`.add-btn[data-word="${item.word}"]`);
        if (btn) {
            btn.textContent = '✓ Добавлено';
            btn.classList.add('added');
            btn.disabled = true;
        }
    }
}

async function addToDeck(word, translation) {
    const response = await fetch(`/api/deck/${currentLanguage}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, translation })
    });
    const data = await response.json();
    return data.status === 'added';
}

async function addToDeckAndRefresh(btn, word, translation) {
    const added = await addToDeck(word, translation);
    if (added) {
        showToast(`✅ "${word}" добавлен в колоду`);
        btn.textContent = '✓ Добавлено';
        btn.classList.add('added');
        btn.disabled = true;
        await loadDeck();
    } else {
        showToast(`⚠️ "${word}" уже есть в колоде`);
        btn.textContent = '✓ Добавлено';
        btn.classList.add('added');
        btn.disabled = true;
    }
}

// Ручной ввод
async function addManualWord() {
    const input = document.getElementById('manualWord');
    const word = input.value.trim();
    if (!word) return;
    
    let translation = '';
    if (currentLanguage === 'chinese') {
        const response = await fetch('/api/pinyin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: word })
        });
        const data = await response.json();
        translation = data.pinyin;
    }
    
    const added = await addToDeck(word, translation);
    if (added) {
        manualAddedWordsByLang[currentLanguage].unshift({ word, translation });
        updateTempAddedDisplay();
        input.value = '';
        showToast(`✅ "${word}" добавлен в колоду`);
        await loadDeck();
    } else {
        showToast(`⚠️ "${word}" уже есть в колоде`);
    }
}

function updateTempAddedDisplay() {
    const section = document.getElementById('addedWordsSection');
    const grid = document.getElementById('addedWordsGrid');
    const words = manualAddedWordsByLang[currentLanguage];
    
    if (words.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = 'block';
    grid.innerHTML = words.slice(0, 10).map(item => `
        <div class="added-word-card">
            <span class="added-word-text">${escapeHtml(item.word)}</span>
            <span style="font-size: 12px; color: #888;">${escapeHtml(item.translation)}</span>
        </div>
    `).join('');
}

// Повторение
function startReview() {
    if (currentDeck.length === 0) {
        document.getElementById('noCardsMsg').style.display = 'block';
        document.getElementById('reviewCard').style.display = 'none';
        document.getElementById('reviewContainer').style.display = 'flex';
        return;
    }
    reviewCards = [...currentDeck];
    for (let i = reviewCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [reviewCards[i], reviewCards[j]] = [reviewCards[j], reviewCards[i]];
    }
    currentCardIndex = 0;
    isReviewActive = true;
    document.getElementById('noCardsMsg').style.display = 'none';
    document.getElementById('reviewCard').style.display = 'block';
    document.getElementById('reviewContainer').style.display = 'none';
    showCurrentCard();
}

function showCurrentCard() {
    if (!isReviewActive) return;
    if (currentCardIndex >= reviewCards.length) {
        showToast('🎉 Поздравляю! Вы повторили все слова!');
        isReviewActive = false;
        document.getElementById('reviewCard').style.display = 'none';
        document.getElementById('reviewContainer').style.display = 'flex';
        return;
    }
    const card = reviewCards[currentCardIndex];
    document.getElementById('reviewWord').textContent = card.word;
    document.getElementById('reviewTranslation').textContent = card.translation || '';
    document.getElementById('reviewTranslation').style.display = 'none';
}

function revealAnswer() {
    document.getElementById('reviewTranslation').style.display = 'block';
}

function nextCard(result) {
    if (!isReviewActive) return;
    if (result === 'again') {
        reviewCards.push(reviewCards[currentCardIndex]);
    }
    currentCardIndex++;
    showCurrentCard();
}

document.getElementById('reviewWord')?.addEventListener('click', revealAnswer);

// Импорт Anki
async function importAnki() {
    const text = document.getElementById('importText').value;
    const lines = text.split('\n');
    let imported = 0;
    for (const line of lines) {
        let [word, translation] = line.split(';');
        word = word?.trim();
        translation = translation?.trim() || '';
        if (word) {
            const added = await addToDeck(word, translation);
            if (added) imported++;
        }
    }
    showToast(`Импортировано ${imported} слов`);
    await loadDeck();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m));
}

// Инициализация
updateLanguageUI();
loadDeck();