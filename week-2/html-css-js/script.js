// 1. 타이핑 애니메이션
const phrases = ['HTML + CSS + JavaScript', '다양한 태그 예시 모음', '인터랙티브 웹 페이지'];
let phraseIdx = 0, charIdx = 0, isDeleting = false;
const typingEl = document.getElementById('typing-text');

function type() {
    const current = phrases[phraseIdx];
    if (isDeleting) {
        charIdx--;
    } else {
        charIdx++;
    }
    typingEl.innerHTML = current.substring(0, charIdx) + '<span class="cursor-blink"></span>';

    let speed = isDeleting ? 40 : 80;

    if (!isDeleting && charIdx === current.length) {
        speed = 1500;
        isDeleting = true;
    } else if (isDeleting && charIdx === 0) {
        isDeleting = false;
        phraseIdx = (phraseIdx + 1) % phrases.length;
        speed = 400;
    }
    setTimeout(type, speed);
}
type();

// 2. 스크롤 페이드인 (Intersection Observer)
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        } else {
            entry.target.classList.remove('visible');
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

// 3. 다크모드 토글
document.getElementById('dark-toggle').addEventListener('click', function() {
    document.body.classList.toggle('dark');
    this.textContent = document.body.classList.contains('dark') ? '라이트모드' : '다크모드';
});

// 4. 카운터
let count = 0;
function changeCount(delta) {
    count += delta;
    const display = document.getElementById('count-display');
    display.textContent = count;
    display.classList.add('bump');
    setTimeout(() => display.classList.remove('bump'), 200);
}

// 5. 랜덤 색상 박스
function changeColor() {
    const colors = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#fd79a8'];
    const box = document.getElementById('color-box');
    const random = colors[Math.floor(Math.random() * colors.length)];
    box.style.backgroundColor = random;
    box.textContent = random;
}

// 6. 투두 리스트
function addTodo() {
    const input = document.getElementById('todo-input');
    const text = input.value.trim();
    if (!text) return;

    const li = document.createElement('li');
    li.innerHTML = `<span>${text}</span><button class="delete-btn" onclick="deleteTodo(this)">삭제</button>`;
    li.querySelector('span').addEventListener('click', function() {
        li.classList.toggle('done');
    });
    document.getElementById('todo-list').appendChild(li);
    input.value = '';
}

function deleteTodo(btn) {
    const li = btn.parentElement;
    li.style.opacity = '0';
    li.style.transform = 'translateX(50px)';
    setTimeout(() => li.remove(), 300);
}

// 7. 리플 효과 (버튼 클릭 시)
document.querySelectorAll('button:not(.counter-btn):not(#dark-toggle):not(.delete-btn)').forEach(btn => {
    btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.addEventListener('click', function(e) {
        const ripple = document.createElement('span');
        ripple.classList.add('ripple');
        const rect = this.getBoundingClientRect();
        ripple.style.width = ripple.style.height = Math.max(rect.width, rect.height) + 'px';
        ripple.style.left = (e.clientX - rect.left - rect.width / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - rect.height / 2) + 'px';
        this.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    });
});

// 8. 진행 바 애니메이션
let progressInterval = null;
const progressObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        const bar = document.getElementById('progress-bar');
        const text = document.getElementById('progress-text');
        if (entry.isIntersecting) {
            let val = 0;
            bar.value = 0;
            text.textContent = '0%';
            if (progressInterval) clearInterval(progressInterval);
            progressInterval = setInterval(() => {
                val++;
                bar.value = val;
                text.textContent = val + '%';
                if (val >= 70) clearInterval(progressInterval);
            }, 20);
        } else {
            if (progressInterval) clearInterval(progressInterval);
            bar.value = 0;
            text.textContent = '0%';
        }
    });
}, { threshold: 0.5 });
progressObserver.observe(document.getElementById('progress-bar'));

// 9. 폼 제출 인터랙션
document.querySelector('form').addEventListener('submit', function(e) {
    e.preventDefault();
    const name = document.getElementById('name').value;
    if (name) {
        alert(name + '님, 환영합니다!');
    } else {
        alert('이름을 입력해주세요.');
    }
});

// 10. 테이블 셀 클릭 하이라이트
document.querySelectorAll('td').forEach(td => {
    td.style.cursor = 'pointer';
    td.addEventListener('click', function() {
        document.querySelectorAll('td').forEach(t => t.style.backgroundColor = '');
        this.style.backgroundColor = '#f1c40f';
    });
});
