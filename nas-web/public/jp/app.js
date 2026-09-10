const dataStore = window.dataContent || {};
const navList = document.getElementById('nav-list');
const contentArea = document.getElementById('content-area');

// 状态管理逻辑（保持不变）
function getState(wordKey) {
    const states = JSON.parse(localStorage.getItem('vocabMemory')) || {};
    return states[wordKey] || { difficulty: 1, reviewCount: 0, memorized: false };
}
function setState(wordKey, state) {
    const states = JSON.parse(localStorage.getItem('vocabMemory')) || {};
    states[wordKey] = state;
    localStorage.setItem('vocabMemory', JSON.stringify(states));
}

// 生成左侧导航（保持不变）
Object.keys(dataStore).forEach(key => {
    const file = dataStore[key];
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.textContent = key;
    a.onclick = () => render(key, a);
    li.appendChild(a);
    navList.appendChild(li);
});

// 渲染函数
function render(key, activeLink) {
    document.querySelectorAll('.sidebar a').forEach(a => a.classList.remove('active'));
    if(activeLink) activeLink.classList.add('active');

    const file = dataStore[key];
    contentArea.innerHTML = `<h1>${file.title}</h1>`;

    if (file.type === 'vocab') {
        // 词汇渲染逻辑（保持不变）
        contentArea.innerHTML += `
            <table>
                <thead><tr><th>汉字</th><th>假名 (可隐藏)</th><th>音调</th><th>词性</th><th>释义 (可隐藏)</th><th>记忆技巧/词源</th><th>管理</th></tr></thead>
                <tbody id="vocab-body"></tbody>
            </table>
        `;
        renderRows(file.words);
        
    } else if (file.type === 'grammar') {
        // *** 语法渲染逻辑：先输出大分类，再输出该分类下的语法点 ***
        if (file.sections) {
            file.sections.forEach(section => {
                // 1. 输出大分类的标题
                contentArea.innerHTML += `<div class="section-category">${section.category}</div>`;
                
                // 2. 循环输出该分类下的所有语法点
                section.items.forEach(item => {
                    contentArea.innerHTML += `
                        <div class="card">
                            <div class="section-title">${item.point}</div>
                            <div class="explain-text">${item.explain}</div>
                            <div class="example-box">
                                <p><b>例句：</b>${item.example}</p>
                                <p><b>译文：</b>${item.translation}</p>
                            </div>
                        </div>
                    `;
                });
            });
        } else {
            // 兼容旧的没有分类的数据
            file.items.forEach(item => {
                contentArea.innerHTML += `<div class="card">... </div>`;
            });
        }
    }
}

// 渲染词表行（只有管理按钮）
function renderRows(words) {
    const tbody = document.getElementById('vocab-body');
    tbody.innerHTML = '';

    words.forEach(word => {
        const wordKey = word.kanji + word.kana;
        const state = getState(wordKey);
        const isMemorized = state.memorized;
        const kanaClass = isMemorized ? '' : 'blur';
        const meanClass = isMemorized ? '' : 'blur';
        const origin = word.origin ? `<div class="origin-text">${word.origin}</div>` : '';
        
        tbody.innerHTML += `
            <tr>
                <td>${word.kanji}</td>
                <td>
                    <span id="kana-${wordKey}" class="${kanaClass}">${word.kana}</span>
                    <button class="btn-toggle" onclick="toggleDisplay('${wordKey}', 'kana')">隐/显</button>
                </td>
                <td>${word.tone}</td>
                <td>${word.type}</td>
                <td>
                    <span id="mean-${wordKey}" class="${meanClass}">${word.mean}</span>
                    <button class="btn-toggle" onclick="toggleDisplay('${wordKey}', 'mean')">隐/显</button>
                </td>
                <td>${origin}</td>
                <td>
                    <button class="btn-manage" onclick="openModal('${wordKey}')">管理</button>
                </td>
            </tr>
        `;
    });
}

// 单行隐藏/显示功能（保持不变）
function toggleDisplay(wordKey, type) {
    const element = document.getElementById(`${type}-${wordKey}`);
    if (element.classList.contains('blur')) {
        element.classList.remove('blur');
    } else {
        element.classList.add('blur');
    }
}

// ============ 弹窗相关逻辑 ============

let currentModalWordKey = null;

function openModal(wordKey) {
    currentModalWordKey = wordKey;
    
    // 找到当前的单词对象用于显示在弹窗标题
    let word = null;
    for(const key in dataStore) {
        if(dataStore[key].type === 'vocab') {
            const found = dataStore[key].words.find(w => (w.kanji + w.kana) === wordKey);
            if(found) { word = found; break; }
        }
    }
    
    document.getElementById('modal-title').innerText = `${word.kanji} (${word.kana})`;
    updateModalState();
    document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    currentModalWordKey = null;
}

// 更新弹窗内的数字和状态
function updateModalState() {
    if (!currentModalWordKey) return;
    const state = getState(currentModalWordKey);
    
    document.getElementById('modal-difficulty').innerText = '⭐'.repeat(state.difficulty);
    document.getElementById('modal-count').innerText = state.reviewCount;
    document.getElementById('modal-memorized').innerText = state.memorized ? '已记住' : '未记住';
}

function modalIncreaseCount() {
    if (!currentModalWordKey) return;
    let state = getState(currentModalWordKey);
    state.reviewCount++;
    setState(currentModalWordKey, state);
    updateModalState();
    refreshCurrentTable(); // 主表格也刷新一下，以防万一
}

function modalMark(action) {
    if (!currentModalWordKey) return;
    let state = getState(currentModalWordKey);
    if (action === 'remember') {
        state.memorized = true;
        state.difficulty = Math.max(state.difficulty - 1, 1);
    } else {
        state.memorized = false;
        state.difficulty = Math.min(state.difficulty + 1, 5);
    }
    setState(currentModalWordKey, state);
    updateModalState();
    refreshCurrentTable();
}

// 刷新当前表格函数
function refreshCurrentTable() {
    for (const key in dataStore) {
        if(dataStore[key].type === 'vocab' && document.getElementById('vocab-body')) {
            renderRows(dataStore[key].words);
            break;
        }
    }
}

// 默认渲染第一个
const firstKey = Object.keys(dataStore)[0];
if(firstKey) render(firstKey);