import { useEffect, useReducer, useRef } from 'react';
import { probeReducer } from '../application/probeState';
import { startWorkerProbe } from '../application/probeController';

const labels = {
  idle: 'Проверка ещё не запускалась',
  checking: 'Проверяем связь…',
  ready: 'Worker готов · BigInt доступен',
  error: 'Не удалось связаться с Worker. Повторите проверку.',
};

export function App() {
  const [state, dispatch] = useReducer(probeReducer, 'idle');
  const stop = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => stop.current?.(), []);
  const check = () => {
    stop.current?.();
    dispatch('start');
    stop.current = startWorkerProbe((success) => dispatch(success ? 'success' : 'failure'));
  };

  return (
    <main className="mx-auto max-w-5xl px-page py-10 tablet:py-16 desktop:py-20">
      <header className="mb-8">
        <p className="mb-2 font-semibold text-brand">MealPlan</p>
        <h1 className="text-3xl font-bold tablet:text-4xl">План питания начинается здесь</h1>
        <p className="mt-4 max-w-2xl text-muted">Подготавливаем приложение для меню, запасов и покупок.</p>
      </header>
      <div data-testid="shell-grid" className="grid gap-6 tablet:grid-cols-2 desktop:grid-cols-3">
        <section className="rounded-panel border border-line bg-surface p-6 tablet:col-span-2">
          <h2 className="text-xl font-semibold">Каркас приложения</h2>
          <p className="mt-3 text-muted">Меню, расчёты и сохранение пока не реализованы. Эта страница проверяет запуск приложения и отдельного потока вычислений.</p>
          <button className="mt-6 min-h-12 rounded-lg bg-brand px-5 py-3 font-semibold text-white disabled:opacity-60" disabled={state === 'checking'} onClick={check}>
            Проверить Worker
          </button>
          <p role="status" className="mt-4 text-sm text-muted">{labels[state]}</p>
        </section>
        <aside className="rounded-panel border border-line bg-surface p-6">
          <h2 className="text-xl font-semibold">Следующие шаги</h2>
          <p className="mt-3 text-muted">Принятый каталог, точные расчёты, параметры и локальное хранение появятся в следующих задачах.</p>
        </aside>
      </div>
    </main>
  );
}
