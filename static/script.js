// Конфигурация языков
const languageConfig = {
    chinese: {
        placeholder: 'Введите слово или предложение...',
        wordsLabel: 'Слова',
        notFound: 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        processing: 'Распознавание текста...',
        completed: '✅ Распознавание китайского текста завершено!'
    },
    english: {
        placeholder: 'Введите слово или предложение...',
        wordsLabel: 'Слова',
        notFound: 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        processing: 'Распознавание текста...',
        completed: '✅ Распознавание английского текста завершено!'
    },
    russian: {
        placeholder: 'Введите слово или предложение...',
        wordsLabel: 'Слова',
        notFound: 'Слова не найдены. Попробуйте другое фото или ручной ввод',
        processing: 'Распознавание текста...',
        completed: '✅ Распознавание русского текста завершено!'
    }
};

let currentLanguage = 'chinese';
let currentDeck = [];

// Данные для каждой вкладки языка (временные карточки с id)
let manualAddedWordsByLang = {
    chinese: [],
    english: [],
    russian: []
};

let ocrResultsByLang = {
    chinese: null,
    english: null,
    russian: null
};

let previewsByLang = {
    chinese: null,
    english: null,
    russian: null
};

let processingStatusByLang = {
    chinese: false,
    english: false,
    russian: false
};

// Переменные для повторения
let reviewCards = [];
let currentCardIndex = 0;
let isReviewActive = false;
let reviewStats = {
    total: 0,
    correct: 0,
    incorrect: 0
};
let reviewMode = false; // false: слово→перевод, true: перевод→слово

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = isError ? '#dc2626' : '#1a1a1a';
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        toast.style.background = '#1a1a1a';
    }, 3000);
}

function getLanguageName(lang) {
    const names = { chinese: 'китайского', english: 'английского', russian: 'русского' };
    return names[lang] || lang;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] || m));
}

// ===== ПРОВЕРКА СООТВЕТСТВИЯ ЯЗЫКА =====
function validateLanguage(word, language) {
    if (language === 'chinese') {
        return /[\u4e00-\u9fff]/.test(word);
    } else if (language === 'english') {
        return /^[a-zA-Z\s\-']+$/.test(word.replace(/[^a-zA-Z\s\-']/g, '')) && 
               !/[\u4e00-\u9fff]/.test(word) && 
               !/[а-яА-ЯёЁ]/.test(word);
    } else if (language === 'russian') {
        return /^[а-яА-ЯёЁ\s\-]+$/.test(word.replace(/[^а-яА-ЯёЁ\s\-]/g, '')) && 
               !/[\u4e00-\u9fff]/.test(word) && 
               !/[a-zA-Z]/.test(word);
    }
    return true;
}

// ===== ПОЛУЧЕНИЕ ПЕРЕВОДА =====
async function getTranslationForWord(word, language) {
    try {
        if (language === 'chinese') {
            const pinyinRes = await fetch('/api/pinyin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: word })
            });
            const pinyinData = await pinyinRes.json();
            const pinyinText = pinyinData.pinyin || '';
            
            const translateRes = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: word, source: 'zh-CN', target: 'ru' })
            });
            const translateData = await translateRes.json();
            const russianTranslation = translateData.translation || '';
            
            if (pinyinText && russianTranslation) {
                return `${pinyinText} - ${russianTranslation}`;
            } else if (pinyinText) {
                return pinyinText;
            } else if (russianTranslation) {
                return russianTranslation;
            }
            return '';
        } else if (language === 'english') {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: word, source: 'en', target: 'ru' })
            });
            const data = await res.json();
            return data.translation || '';
        } else if (language === 'russian') {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: word, source: 'ru', target: 'en' })
            });
            const data = await res.json();
            return data.translation || '';
        }
    } catch (e) {
        console.error('Ошибка перевода:', e);
        return '';
    }
    return '';
}

// ===== ОБНОВЛЕНИЕ UI =====
function updateLanguageUI() {
    const config = languageConfig[currentLanguage];
    const manualInput = document.getElementById('manualWord');
    if (manualInput) manualInput.placeholder = config.placeholder;
    const resultsTitle = document.getElementById('resultsTitle');
    if (resultsTitle) resultsTitle.textContent = config.wordsLabel;
    
    updateTempAddedDisplay();
    updateOCRDisplayForCurrentLanguage();
    updateImportPlaceholder();
}

async function updateOCRDisplayForCurrentLanguage() {
    const resultsSection = document.getElementById('resultsSection');
    const wordsGrid = document.getElementById('wordsGrid');
    const dropZone = document.getElementById('dropZone');
    const previewContainer = document.getElementById('previewContainer');
    const previewImg = document.getElementById('previewImg');
    
    if (previewsByLang[currentLanguage]) {
        previewImg.src = previewsByLang[currentLanguage];
        dropZone.classList.add('with-preview');
        previewContainer.style.display = 'block';
    } else {
        dropZone.classList.remove('with-preview');
        previewContainer.style.display = 'none';
        previewImg.src = '';
    }
    
    if (ocrResultsByLang[currentLanguage] && ocrResultsByLang[currentLanguage].words) {
        resultsSection.style.display = 'block';
        await displayResults(ocrResultsByLang[currentLanguage].words);
    } else if (processingStatusByLang[currentLanguage]) {
        resultsSection.style.display = 'block';
        const config = languageConfig[currentLanguage];
        wordsGrid.innerHTML = `<div style="text-align: center; padding: 40px;">${config.processing}</div>`;
    } else if (ocrResultsByLang[currentLanguage] === null) {
        resultsSection.style.display = 'none';
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
        <div class="added-word-card" data-id="${item.id}">
            <div style="flex: 1;">
                <div class="added-word-text">${escapeHtml(item.word)}</div>
                <div class="added-word-translation" style="font-size: 12px; color: #888;">${escapeHtml(item.translation)}</div>
            </div>
            <button class="remove-added-word" onclick="removeManualWord(${item.id})">✖</button>
        </div>
    `).join('');
}

async function removeManualWord(id) {
    const words = manualAddedWordsByLang[currentLanguage];
    const index = words.findIndex(item => item.id === id);
    
    if (index !== -1) {
        const wordToRemove = words[index].word;
        
        // Удаляем из временного хранилища
        words.splice(index, 1);
        updateTempAddedDisplay();
        
        // Удаляем из колоды на сервере
        try {
            const response = await fetch(`/api/deck/${currentLanguage}/${encodeURIComponent(wordToRemove)}`, { 
                method: 'DELETE' 
            });
            
            if (response.ok) {
                showToast(`🗑️ "${wordToRemove}" удалён из колоды`);
                // Перезагружаем колоду, чтобы обновить интерфейс
                await loadDeck();
                
                // Обновляем отображение OCR результатов, если есть
                if (ocrResultsByLang[currentLanguage]) {
                    await displayResults(ocrResultsByLang[currentLanguage].words);
                }
            } else {
                showToast(`❌ Не удалось удалить "${wordToRemove}"`, true);
            }
        } catch (e) {
            console.error('Ошибка удаления:', e);
            showToast(`❌ Ошибка при удалении`, true);
        }
    }
}

function updateImportPlaceholder() {
    const textarea = document.getElementById('importText');
    if (!textarea) return;
    
    if (currentLanguage === 'chinese') {
        textarea.placeholder = '你;ni3 - перевод\n好;hao3 - перевод\n谢谢;xie4xie - перевод';
    } else if (currentLanguage === 'english') {
        textarea.placeholder = 'hello;привет\nworld;мир\nlanguage;язык';
    } else if (currentLanguage === 'russian') {
        textarea.placeholder = 'привет;hello\nмир;world\nязык;language';
    }
}

// ===== РАБОТА С КОЛОДОЙ =====
async function loadDeck() {
    try {
        const response = await fetch(`/api/deck/${currentLanguage}`);
        currentDeck = await response.json();
        updateDeckUI();
    } catch (e) {}
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
    if (ocrResultsByLang[currentLanguage]) {
        await displayResults(ocrResultsByLang[currentLanguage].words);
    }
}

async function clearDeck() {
    if (confirm('Удалить все слова из колоды?')) {
        await fetch(`/api/deck/${currentLanguage}`, { method: 'DELETE' });
        await loadDeck();
        if (ocrResultsByLang[currentLanguage]) {
            await displayResults(ocrResultsByLang[currentLanguage].words);
        }
    }
}

async function addToDeck(word, translation) {
    try {
        const response = await fetch(`/api/deck/${currentLanguage}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word, translation })
        });
        const data = await response.json();
        return data.status === 'added';
    } catch (e) {
        return false;
    }
}

// ===== РУЧНОЙ ВВОД (С ПРОВЕРКОЙ, ПЕРЕВОДОМ И КРЕСТИКОМ) =====
async function addManualWord() {
    const input = document.getElementById('manualWord');
    const word = input.value.trim();
    if (!word) return;
    
    // Проверка на правильный язык
    if (!validateLanguage(word, currentLanguage)) {
        let errorMsg = '';
        if (currentLanguage === 'chinese') {
            errorMsg = 'Пожалуйста, введите китайские иероглифы';
        } else if (currentLanguage === 'english') {
            errorMsg = 'Пожалуйста, введите английские слова';
        } else if (currentLanguage === 'russian') {
            errorMsg = 'Пожалуйста, введите русские слова';
        }
        showToast(`⚠️ ${errorMsg}`, true);
        input.value = '';
        return;
    }
    
    // Получаем перевод
    let translation = await getTranslationForWord(word, currentLanguage);
    
    // Добавляем в колоду
    const added = await addToDeck(word, translation);
    if (added) {
        const newCard = {
            id: Date.now() + Math.random(),
            word: word,
            translation: translation
        };
        manualAddedWordsByLang[currentLanguage].unshift(newCard);
        updateTempAddedDisplay();
        input.value = '';
        showToast(`✅ "${word}" добавлен в колоду`);
        await loadDeck();
        
        if (ocrResultsByLang[currentLanguage]) {
            await displayResults(ocrResultsByLang[currentLanguage].words);
        }
    } else {
        showToast(`⚠️ "${word}" уже есть в колоде`);
    }
}

// ===== OCR РАСПОЗНАВАНИЕ =====
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
    processingStatusByLang[language] = false;
    
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

async function processImage(file) {
    const ocrLanguage = currentLanguage;
    const config = languageConfig[ocrLanguage];
    
    const reader = new FileReader();
    reader.onload = (e) => {
        showPreviewForLanguage(e.target.result, ocrLanguage);
    };
    reader.readAsDataURL(file);
    
    ocrResultsByLang[ocrLanguage] = null;
    processingStatusByLang[ocrLanguage] = true;
    
    const resultsSection = document.getElementById('resultsSection');
    const wordsGrid = document.getElementById('wordsGrid');
    resultsSection.style.display = 'block';
    wordsGrid.innerHTML = `<div style="text-align: center; padding: 40px;">${config.processing}</div>`;
    
    const formData = new FormData();
    formData.append('image', file);
    formData.append('language', ocrLanguage);

    try {
        const response = await fetch('/api/ocr', { method: 'POST', body: formData });
        const data = await response.json();

        processingStatusByLang[ocrLanguage] = false;

        if (data.error) {
            ocrResultsByLang[ocrLanguage] = { words: [] };
            wordsGrid.innerHTML = `<div style="text-align: center; padding: 40px; color: #888;">❌ Ошибка: ${data.error}</div>`;
            showToast(`❌ Ошибка распознавания: ${data.error}`, true);
        } else if (data.words && data.words.length > 0) {
            ocrResultsByLang[ocrLanguage] = { words: data.words };
            await displayResults(data.words);
            showToast(config.completed);
        } else {
            ocrResultsByLang[ocrLanguage] = { words: [] };
            wordsGrid.innerHTML = `<div style="text-align: center; padding: 40px; color: #888;">${config.notFound}</div>`;
            showToast(`⚠️ ${config.notFound}`);
        }
    } catch (error) {
        processingStatusByLang[ocrLanguage] = false;
        ocrResultsByLang[ocrLanguage] = { words: [] };
        wordsGrid.innerHTML = `<div style="text-align: center; padding: 40px; color: #888;">❌ Ошибка соединения с сервером</div>`;
        showToast('❌ Ошибка соединения с сервером', true);
    }
}

async function displayResults(words) {
    const container = document.getElementById('wordsGrid');
    document.getElementById('resultsStats').textContent = `${words.length} слов`;
    
    await loadDeck();
    
    const existingWords = new Set(currentDeck.map(item => item.word));
    
    container.innerHTML = words.map(word => {
        const isAdded = existingWords.has(word.word);
        return `
            <div class="word-card">
                <div class="word-text">${escapeHtml(word.word)}</div>
                <div class="word-translation">${escapeHtml(word.translation || '')}</div>
                <button class="add-btn" data-word="${escapeHtml(word.word)}" data-translation="${escapeHtml(word.translation || '')}" onclick="addToDeckAndRefresh(this, '${escapeHtml(word.word)}', '${escapeHtml(word.translation || '')}')">
                    ${isAdded ? '✓ Добавлено' : '➕ Добавить'}
                </button>
            </div>
        `;
    }).join('');
    
    for (const item of currentDeck) {
        const btn = document.querySelector(`.add-btn[data-word="${item.word}"]`);
        if (btn) {
            btn.textContent = '✓ Добавлено';
            btn.classList.add('added');
            btn.disabled = true;
        }
    }
}

async function addToDeckAndRefresh(btn, word, translation) {
    const added = await addToDeck(word, translation);
    if (added) {
        showToast(`✅ "${word}" добавлен в колоду`);
        btn.textContent = '✓ Добавлено';
        btn.classList.add('added');
        btn.disabled = true;
        await loadDeck();
        
        const allBtns = document.querySelectorAll('.add-btn');
        for (const button of allBtns) {
            const btnWord = button.getAttribute('data-word');
            if (currentDeck.some(item => item.word === btnWord)) {
                button.textContent = '✓ Добавлено';
                button.classList.add('added');
                button.disabled = true;
            }
        }
    } else {
        showToast(`⚠️ "${word}" уже есть в колоде`);
        btn.textContent = '✓ Добавлено';
        btn.classList.add('added');
        btn.disabled = true;
    }
}

// ===== ПОВТОРЕНИЕ =====
function toggleReviewMode() {
    reviewMode = document.getElementById('modeToggle').checked;
    if (isReviewActive) {
        showCurrentCard();
    }
}

function updateReviewStats() {
    const remaining = reviewCards.length - currentCardIndex;
    const statsElement = document.getElementById('reviewStats');
    if (statsElement) {
        statsElement.innerHTML = `✅ ${reviewStats.correct} / ❌ ${reviewStats.incorrect} | 📋 осталось: ${remaining}`;
    }
    
    const progressBar = document.getElementById('progressBar');
    if (progressBar && reviewCards.length > 0) {
        const progress = (currentCardIndex / reviewCards.length) * 100;
        progressBar.style.width = `${progress}%`;
    }
}

function startReview() {
    if (currentDeck.length === 0) {
        document.getElementById('noCardsMsg').style.display = 'block';
        document.getElementById('reviewCard').style.display = 'none';
        document.getElementById('reviewContainer').style.display = 'flex';
        return;
    }
    
    reviewStats = {
        total: currentDeck.length,
        correct: 0,
        incorrect: 0
    };
    
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
    
    updateReviewStats();
    showCurrentCard();
}

function showCurrentCard() {
    if (!isReviewActive) return;
    
    if (currentCardIndex >= reviewCards.length) {
        const totalAnswered = reviewStats.correct + reviewStats.incorrect;
        const accuracy = totalAnswered > 0 ? Math.round((reviewStats.correct / totalAnswered) * 100) : 0;
        showToast(`🎉 Поздравляю! Вы повторили все слова! Точность: ${accuracy}%`);
        isReviewActive = false;
        document.getElementById('reviewCard').style.display = 'none';
        document.getElementById('reviewContainer').style.display = 'flex';
        return;
    }
    
    const card = reviewCards[currentCardIndex];
    
    if (!reviewMode) {
        document.getElementById('reviewWord').textContent = card.word;
        document.getElementById('reviewTranslation').textContent = card.translation || '';
    } else {
        document.getElementById('reviewWord').textContent = card.translation || card.word;
        document.getElementById('reviewTranslation').textContent = card.word;
    }
    
    document.getElementById('reviewTranslation').style.display = 'none';
    document.querySelector('.review-card').style.cursor = 'pointer';
    
    updateReviewStats();
}

function flipCard() {
    const translation = document.getElementById('reviewTranslation');
    if (translation.style.display === 'none') {
        translation.style.display = 'block';
    } else {
        translation.style.display = 'none';
    }
}

function nextCard(result) {
    if (!isReviewActive) return;
    
    if (result === 'again') {
        reviewStats.incorrect++;
        reviewCards.push(reviewCards[currentCardIndex]);
    } else {
        reviewStats.correct++;
    }
    
    currentCardIndex++;
    updateReviewStats();
    showCurrentCard();
}

function bindReviewEvents() {
    const reviewWord = document.getElementById('reviewWord');
    const reviewTranslation = document.getElementById('reviewTranslation');
    if (reviewWord) reviewWord.addEventListener('click', flipCard);
    if (reviewTranslation) reviewTranslation.addEventListener('click', flipCard);
}

// ===== ИМПОРТ ANKI =====
async function importAnki() {
    const textarea = document.getElementById('importText');
    const text = textarea.value;
    const lines = text.split('\n');
    
    const targetLanguage = currentLanguage;
    let imported = 0;
    let skipped = 0;
    let warning = '';
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        let word = '';
        let translation = '';
        
        if (line.includes(';')) {
            const parts = line.split(';');
            word = parts[0]?.trim();
            translation = parts[1]?.trim() || '';
        } else {
            word = line.trim();
        }
        
        if (!word) continue;
        
        let isValid = true;
        
        if (targetLanguage === 'chinese') {
            if (!/[\u4e00-\u9fff]/.test(word)) {
                isValid = false;
                warning = 'Импортируйте только китайские иероглифы.';
            }
        } else if (targetLanguage === 'english') {
            if (!/^[a-zA-Z\s\-']+$/.test(word.replace(/[^a-zA-Z\s\-']/g, ''))) {
                isValid = false;
                warning = 'Импортируйте только английские слова.';
            }
        } else if (targetLanguage === 'russian') {
            if (!/^[а-яА-ЯёЁ\s\-]+$/.test(word.replace(/[^а-яА-ЯёЁ\s\-]/g, ''))) {
                isValid = false;
                warning = 'Импортируйте только русские слова.';
            }
        }
        
        if (!isValid) {
            skipped++;
            continue;
        }
        
        const added = await addToDeck(word, translation);
        if (added) imported++;
    }
    
    textarea.value = '';
    
    if (warning && skipped > 0) {
        showToast(`⚠️ ${warning} Импортировано ${imported} слов, пропущено ${skipped}.`, true);
    } else if (imported > 0) {
        showToast(`✅ Импортировано ${imported} слов`);
    } else {
        showToast(`⚠️ Не найдено подходящих слов для импорта`, true);
    }
    
    await loadDeck();
    
    if (ocrResultsByLang[currentLanguage]) {
        await displayResults(ocrResultsByLang[currentLanguage].words);
    }
}

// ===== ПЕРЕКЛЮЧЕНИЕ ЯЗЫКОВ И ВКЛАДОК =====
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
    if (tabId === 'import') {
        const textarea = document.getElementById('importText');
        if (textarea) textarea.value = '';
    }
}

// ===== ГЛОБАЛЬНЫЕ ОБРАБОТЧИКИ =====
document.addEventListener('paste', async (e) => {
    const activeTab = document.querySelector('.tab-content.active')?.id;
    if (activeTab !== 'upload-tab') return;
    
    const items = e.clipboardData.items;
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const blob = item.getAsFile();
            if (blob) {
                const file = new File([blob], 'pasted-image.png', { type: blob.type });
                await processImage(file);
            }
            return;
        }
    }
});

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

const clipboardBtn = document.getElementById('clipboardBtn');
if (clipboardBtn) {
    clipboardBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
            const clipboardItems = await navigator.clipboard.read();
            let imageFound = false;
            for (const item of clipboardItems) {
                const imageTypes = item.types.filter(type => type.startsWith('image/'));
                if (imageTypes.length > 0) {
                    const blob = await item.getType(imageTypes[0]);
                    const file = new File([blob], 'clipboard.png', { type: blob.type });
                    await processImage(file);
                    imageFound = true;
                    return;
                }
            }
            if (!imageFound) {
                showToast('В буфере обмена нет изображения');
            }
        } catch (err) {
            showToast('Не удалось получить изображение из буфера обмена');
        }
    });
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
updateImportPlaceholder();
updateLanguageUI();
loadDeck();
bindReviewEvents();