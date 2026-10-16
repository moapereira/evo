import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datasDeVenda, vendasDoMes, financeiroTravado, inicioDoMes } from '../src/negocio.js';

const agora = new Date('2026-10-16T15:00:00Z').getTime();
const t = (code, status, setup, rec, createdAt, extra = {}) => ({ code, status, setupAmount: setup, recurringAmount: rec, createdAt, type: 'upsell', ...extra });

test('inicioDoMes usa o dia 1 às 00:00 UTC, como o Dashboard do Nexu', () => {
  assert.equal(inicioDoMes(agora).toISOString(), '2026-10-01T00:00:00.000Z');
});

test('data da venda: wonAt do lead ganho do mesmo CNPJ mais próximo; senão a criação do ticket', () => {
  const tickets = [
    t('COM-1', 'concluido', 100, 0, '2026-09-29T10:00:00Z', { cnpj: '11.111.111/0001-11' }), // lead ganho em 01/10
    t('COM-2', 'concluido', 50, 0, '2026-09-20T10:00:00Z', { cnpj: '22222222000122' }), // lead de outro ano: fora da janela
    t('COM-3', 'concluido', 70, 0, '2026-10-02T10:00:00Z'), // sem CNPJ
  ];
  const leads = [
    { cnpj: '11111111000111', wonAt: '2025-01-10T10:00:00Z' },
    { cnpj: '11111111000111', wonAt: '2026-10-01T12:00:00Z' },
    { cnpj: '22222222000122', wonAt: '2025-03-01T10:00:00Z' },
  ];
  const d = datasDeVenda(tickets, leads);
  assert.equal(d.get(tickets[0]), '2026-10-01T12:00:00Z');
  assert.equal(d.get(tickets[1]), '2026-09-20T10:00:00Z');
  assert.equal(d.get(tickets[2]), '2026-10-02T10:00:00Z');
});

test('vendasDoMes separa aprovado e aguardando, só COM- do mês', () => {
  const tickets = [
    t('COM-1', 'concluido', 1000, 200, '2026-10-02T10:00:00Z', { type: 'novo' }),
    t('COM-2', 'em_implantacao', 0, 50, '2026-10-05T10:00:00Z'),
    t('COM-3', 'pagamento_confirmado', 300, 0, '2026-10-06T10:00:00Z'),
    t('COM-4', 'pendente_financeiro', 500, 100, '2026-10-07T10:00:00Z'),
    t('COM-5', 'cancelado', 999, 0, '2026-10-07T10:00:00Z'),
    t('COM-6', 'concluido', 999, 0, '2026-09-07T10:00:00Z'),
    t('IMP-7', 'concluido', 999, 0, '2026-10-07T10:00:00Z'),
  ];
  const m = vendasDoMes(tickets, datasDeVenda(tickets, []), agora);
  assert.deepEqual(m.aprovado, { quantidade: 3, setup: 1300, recorrencia: 250, total: 1550 });
  assert.deepEqual(m.aguardando, { quantidade: 1, setup: 500, recorrencia: 100, total: 600 });
  assert.equal(m.clientesNovos, 1);
  assert.equal(m.upsells, 2);
});

test('financeiroTravado: total do mês e os de meses anteriores à parte', () => {
  const tickets = [
    t('COM-1', 'pendente_financeiro', 1000, 0, '2026-09-10T10:00:00Z'),
    t('COM-2', 'pendente_financeiro', 200, 50, '2026-10-10T10:00:00Z'),
    t('COM-3', 'concluido', 999, 0, '2026-10-10T10:00:00Z'),
  ];
  const f = financeiroTravado(tickets, agora, datasDeVenda(tickets, []));
  assert.equal(f.valor, 250);
  assert.equal(f.quantidade, 1);
  assert.deepEqual(f.anteriores, { quantidade: 1, valor: 1000 });
  assert.equal(f.itens.length, 2);
});
