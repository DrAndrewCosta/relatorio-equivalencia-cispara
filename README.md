# Relatório de Equivalência CISPARA

Este projeto é uma aplicação React (Vite + TypeScript) que gera relatórios e permite exportá-los em PDF.

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior.
- [npm](https://www.npmjs.com/) 9 ou superior (instalado junto com o Node).

## Instalação

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Opcional: verifique vulnerabilidades conhecidas nas dependências:

   ```bash
   npm audit
   ```

## Executando em ambiente de desenvolvimento

Inicie o servidor de desenvolvimento do Vite:

```bash
npm run dev
```

O projeto será servido em `http://localhost:5175`. O servidor reinicia automaticamente quando arquivos são modificados.

## Build de produção

Gere os arquivos otimizados para produção:

```bash
npm run build
```

Os artefatos de build serão gerados em `dist/`. Para testar o build localmente, utilize o modo de preview do Vite:

```bash
npm run preview
```

## Verificação de tipos

Execute a checagem estática de tipos:

```bash
npm run typecheck
```

## Gerando arquivo compactado (opcional)

Há um script auxiliar que cria um arquivo `.zip` com os artefatos necessários:

```bash
npm run archive
```

O script gera o arquivo em `./relatorios-ultra-vite.zip`.

## Outras verificações recomendadas

- Execute `npm audit fix` quando necessário para aplicar correções automáticas em dependências vulneráveis.
- Monitore os avisos do Vite sobre o tamanho de bundles para manter o tempo de carregamento baixo.

