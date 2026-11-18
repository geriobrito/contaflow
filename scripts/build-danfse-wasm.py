"""
Compila o gerador oficial de DANFSe da Receita Federal (github.com/ReceitaFederal/
calculadora-rtc-gerador-danfse, licença MIT) para WebAssembly e copia para public/danfse/:
danfse.wasm, wasm_exec.js (o carregador do Go, da mesma versão) e VERSION.json.

O WASM oficial (cmd/danfse-wasm) importa o pacote internal/app, que arrasta o servidor HTTP
(Echo, Swagger, OpenTelemetry) sem usá-lo: 29 MB. Este script gera ao lado dele uma entrada
igual, que monta o mesmo serviço chamando internal/service direto (as duas linhas de
app.NewPdfServiceWithDependencies), e compila essa: cerca de 11 MB (3 MB comprimido). A
geração do PDF é a do código oficial, sem alteração.

Uso (Go na versão pedida pelo go.mod do repositório):

    git clone --depth 1 https://github.com/ReceitaFederal/calculadora-rtc-gerador-danfse /tmp/danfse
    python -I scripts/build-danfse-wasm.py /tmp/danfse /caminho/do/go/bin/go
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys

OUT = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'danfse'
IMPORT = '\tpdfapp "danfse-service/internal/app"\n'
CALL = 'return pdfapp.NewPdfServiceWithDependencies(localidade.BuscarMunicipioGerado, a.renderizador, a.apresentador)'
SLIM_CALL = 'return service.NovoServicoGeracaoPdfDanfseDireto(service.NovoServicoPreparacaoDanfse(localidade.BuscarMunicipioGerado), a.apresentador, a.renderizador)'


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    repo = pathlib.Path(sys.argv[1]).resolve()
    go = pathlib.Path(sys.argv[2]).resolve()

    official = (repo / 'cmd' / 'danfse-wasm' / 'main.go').read_text(encoding='utf-8')
    if IMPORT not in official or CALL not in official:
        sys.exit('A entrada oficial do WASM mudou: revise IMPORT/CALL neste script antes de compilar.')
    slim_dir = repo / 'cmd' / 'danfse-wasm-slim'
    slim_dir.mkdir(exist_ok=True)
    (slim_dir / 'main.go').write_text(official.replace(IMPORT, '').replace(CALL, SLIM_CALL), encoding='utf-8')

    OUT.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'GOOS': 'js', 'GOARCH': 'wasm', 'CGO_ENABLED': '0', 'GOTOOLCHAIN': 'local'}
    subprocess.run(
        [str(go), 'build', '-trimpath', '-ldflags=-s -w', '-o', str(OUT / 'danfse.wasm'), './cmd/danfse-wasm-slim'],
        cwd=repo,
        env=env,
        check=True,
    )
    goroot = pathlib.Path(subprocess.run([str(go), 'env', 'GOROOT'], capture_output=True, text=True, check=True).stdout.strip())
    exec_js = next(p for p in [goroot / 'lib' / 'wasm' / 'wasm_exec.js', goroot / 'misc' / 'wasm' / 'wasm_exec.js'] if p.exists())
    shutil.copyfile(exec_js, OUT / 'wasm_exec.js')

    commit = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    version = subprocess.run([str(go), 'version'], capture_output=True, text=True, check=True).stdout.strip()
    (OUT / 'VERSION.json').write_text(
        json.dumps(
            {
                'repository': 'ReceitaFederal/calculadora-rtc-gerador-danfse',
                'commit': commit,
                'go': version,
                'bytes': (OUT / 'danfse.wasm').stat().st_size,
            },
            ensure_ascii=False,
            indent=2,
        )
        + '\n',
        encoding='utf-8',
    )
    print(f"danfse.wasm ({(OUT / 'danfse.wasm').stat().st_size} bytes) e wasm_exec.js gravados em {OUT}")


if __name__ == '__main__':
    main()
