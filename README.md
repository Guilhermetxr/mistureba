# Sistema Mistureba — gestão da lanchonete

Sistema interno em **HTML + CSS + JavaScript puro** (sem build) com **Firebase** (Auth, Firestore, Hosting e Cloud Functions).

## O que tem

| Área | Telas |
|---|---|
| **CMV** (foco) | Painel do CMV (teórico × real, perdas, divergência de inventário, CMV por dia/categoria, insumos que subiram), Fichas técnicas com custo ao vivo e preço sugerido, Preparos/sub-receitas e combos, Engenharia de cardápio (estrela / burro de carga / enigma / cão), Simulador (aumento de insumo e reajuste de preços) |
| **Operação** | PDV (balcão, delivery, iFood manual; pagamento dividido, troco, desconto, observação por item, cupom e comanda), Caixa (abertura, sangria, suprimento, fechamento com contagem por cédula), Vendas (cancelamento com estorno de estoque) |
| **Estoque** | Insumos com fator de correção e estoque mínimo, Compras (atualizam estoque e custo médio/último) com **scanner de nota** — foto via OCR Tesseract.js ou XML da NF-e, casando cada item com o insumo e lembrando por fornecedor, Inventário (curva ABC), Perdas |
| **Financeiro** | Diário (por forma de pagamento, bruto/taxa/líquido), Mensal (DRE + ponto de equilíbrio), Contas a pagar/receber com contas fixas recorrentes, Recebíveis (quando a maquininha e o iFood vão depositar) |
| **Integrações** | Stone (taxas por forma de pagamento; modo integrado Stone Connect opcional), iFood (comissão; importação automática de pedidos via Merchant API) |
| **Config.** | Empresa, metas de CMV e imposto, taxas da maquininha, Stone, iFood, usuários (admin/caixa), categorias do DRE |

Perfis: **Administrador** vê tudo. **Caixa** só acessa PDV, caixa, vendas do dia e perdas (garantido pelas regras do Firestore, não só pela tela).

O PDV funciona **offline**: as vendas são gravadas no cache local do Firestore e sincronizam quando a internet volta.

## Rodar local (sem conta no Firebase)

Precisa de Node 22+, Java 21+ e o Firebase CLI (`npm i -g firebase-tools`).

```bash
cd functions && npm install && cd ..
npm run dev
```

Abra http://127.0.0.1:5000. No primeiro acesso o sistema pede para criar o administrador (com opção de cardápio de exemplo). Painel dos emuladores: http://127.0.0.1:4000. Os dados ficam salvos em `.emulator-data/` ao parar com Ctrl+C.

## Colocar no ar

Projeto Firebase: **mistureba-27832** — site em https://mistureba-27832.web.app

```bash
firebase login            # conta dona do projeto
npm run deploy            # site + regras + índices do Firestore (funciona no plano gratuito)
npm run deploy:functions  # Stone integrada e iFood automático (exige plano Blaze)
```

Em `localhost` o app usa os emuladores (projeto `demo-mistureba`), então testes locais nunca tocam o banco real. Pra apontar o localhost pro projeto real, abra com `?prod` na URL.

Para outro projeto Firebase: troque a config em `public/js/firebase-config.js` e o ID em `.firebaserc`; no console ative **Authentication › E-mail/senha** e crie o **Firestore** em `southamerica-east1`.

As **Cloud Functions** (Stone integrada e iFood automático) exigem o plano **Blaze**. Sem elas, todo o resto funciona: Stone no modo manual e iFood lançado pelo PDV.

## Integrações — o que falta pra ligar

- **Stone**: no modo manual não precisa de nada além de cadastrar as taxas. Para o modo integrado, peça à Stone acesso ao **Stone Connect** (API Pagar.me v5 + POS) e coloque a chave `sk_…` e o número de série das maquininhas em Configurações › Stone. O formato da chamada (`functions/index.js`, `stoneCharge`) foi escrito pela documentação pública e **precisa ser validado no ambiente de homologação** da Stone antes de usar no balcão.
- **iFood**: cadastre um app no [Portal do Desenvolvedor](https://developer.ifood.com.br), passe pela homologação e cole Client ID/Secret e Merchant ID em Configurações › iFood. Preencha o "Código no iFood" de cada ficha técnica para o pedido baixar estoque e calcular CMV. Também precisa de teste em homologação.

## Estrutura

```
public/
  index.html            casca do app (SPA com rotas por hash)
  css/tokens.css        tokens de design (ver docs/design-tokens.md)
  css/app.css           componentes
  js/firebase*.js       inicialização (emuladores quando projectId começa com "demo-")
  js/costing.js         motor de custo/CMV (puro, copiado para functions/shared)
  js/nota-*.js          scanner de nota: OCR (Tesseract.js no navegador), interpretação de cupom/DANFE/XML e conferência
  js/stats.js           agregados diários de venda (puro, copiado para functions/shared)
  js/services.js        todas as gravações no Firestore
  js/store.js           estado em tempo real (onSnapshot)
  js/views/*.js         uma tela por arquivo
functions/index.js      iFood (polling, ações) e Stone (cobrança, webhook)
firestore.rules         permissões por perfil
```

Relatórios leem `dailyStats/{dia}` (um documento por dia, atualizado com `increment` a cada venda), então um mês inteiro custa ~30 leituras.

Se mexer em `public/js/costing.js` ou `public/js/stats.js`, rode `npm run sync` (o deploy já faz isso).
