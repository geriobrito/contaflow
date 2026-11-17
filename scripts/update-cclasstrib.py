"""
Gera src/lib/nfe/cclasstrib-table.ts com a tabela de classificação tributária (cClassTrib) e de
situação tributária (CST) do IBS/CBS, a partir das migrações SQL do repositório público da
Receita Federal "calculadora-rtc-regime-regular" (pasta flyway/sql).

Uso (sem rodar nada do repositório: só os arquivos .sql são lidos e aplicados num SQLite em
memória, com a biblioteca padrão do Python):

    git clone --depth 1 https://github.com/ReceitaFederal/calculadora-rtc-regime-regular /tmp/rtc
    python -I scripts/update-cclasstrib.py /tmp/rtc

Depois, confira o diff do arquivo gerado (classificações novas, encerradas ou com o indicador de
crédito alterado) e rode os testes.
"""
import json
import pathlib
import sqlite3
import subprocess
import sys

OUT = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'lib' / 'nfe' / 'cclasstrib-table.ts'
# Tributos do IBS/CBS na tabela TRIBUTO: 2 CBS, 3 IBS (UF), 4 IBS (município). 1 é o Imposto Seletivo.
IBS_CBS = (2, 3, 4)


def load(repo: pathlib.Path) -> sqlite3.Connection:
    sql = repo / 'flyway' / 'sql'
    files = [sql / 'criacao' / 'beforeMigrate.sql', sql / 'criacao' / 'B0001__sistema_tributario_completo.sql']
    files += sorted((sql / 'manutencao').glob('V*.sql'), key=lambda p: int(p.name[1:5]))
    files += [sql / 'criacao' / 'afterMigrate.sql']
    db = sqlite3.connect(':memory:')
    for f in files:
        # A checagem de chave estrangeira depende da ordem de carga entre migrações; desligada,
        # o conteúdo das tabelas é o mesmo.
        db.executescript(f.read_text(encoding='utf-8').replace('PRAGMA foreign_keys = ON', 'PRAGMA foreign_keys = OFF'))
    return db


def flag(v):
    return None if v is None else bool(v)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    repo = pathlib.Path(sys.argv[1])
    db = load(repo)
    in_ibs_cbs = f"exists (select 1 from TRIBUTO_SITUACAO_TRIBUTARIA t where t.TRST_SITR_ID = s.SITR_ID and t.TRST_TBTO_ID in {IBS_CBS})"
    cst = db.execute(
        f"select s.SITR_CD, s.SITR_DESCRICAO from SITUACAO_TRIBUTARIA s where {in_ibs_cbs} order by s.SITR_CD"
    ).fetchall()
    rows = db.execute(
        f"""select c.CLTR_CD, s.SITR_CD, c.CLTR_DESCRICAO,
                   c.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_CBS, c.CLTR_IN_APROPRIACAO_CREDITOS_ADQUIRENTES_IBS,
                   c.CLTR_IN_CREDITO_PRESUMIDO_ADQUIRENTE, c.CLTR_TIPO_ALIQUOTA,
                   substr(c.CLTR_INICIO_VIGENCIA, 1, 10), substr(c.CLTR_FIM_VIGENCIA, 1, 10)
            from CLASSIFICACAO_TRIBUTARIA c join SITUACAO_TRIBUTARIA s on s.SITR_ID = c.CLTR_SITR_ID
            where {in_ibs_cbs} order by c.CLTR_CD, c.CLTR_INICIO_VIGENCIA"""
    ).fetchall()
    # Versão da base: a migração de número mais alto registrada (as linhas sem data própria
    # recebem a data da carga, então a data não serve para ordenar).
    versions = [
        (int(v[1:]), v.upper(), d)
        for v, d in db.execute("select VRBD_VERSAO_BASE_DADO, substr(VRBD_DATA, 1, 10) from VERSAO_BASE_DADO")
        if v and v[0] in 'Vv' and v[1:].isdigit()
    ]
    _, version_code, version_date = max(versions)
    version = (version_code, version_date)
    try:
        commit = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        commit = ''

    def js(v):
        return json.dumps(v, ensure_ascii=False)

    lines = [
        '/* Gerado por scripts/update-cclasstrib.py: não edite à mão. */',
        '/* Fonte: github.com/ReceitaFederal/calculadora-rtc-regime-regular (flyway/sql), licença MIT. */',
        '',
        'export const CCLASSTRIB_SOURCE = {',
        f"  repository: 'ReceitaFederal/calculadora-rtc-regime-regular',",
        f'  commit: {js(commit)},',
        f'  dbVersion: {js(version[0])},',
        f'  dbDate: {js(version[1])},',
        '} as const;',
        '',
        '/** CST do IBS/CBS → descrição. */',
        'export const IBS_CBS_CST: Readonly<Record<string, string>> = {',
    ]
    lines += [f'  {js(c)}: {js(d.strip())},' for c, d in cst]
    lines += [
        '};',
        '',
        '/**',
        ' * [cClassTrib, CST, descrição, apropriação de crédito da CBS pelo adquirente, idem do IBS,',
        ' *  crédito presumido do adquirente, tipo de alíquota, início da vigência, fim da vigência].',
        ' * Indicadores null: a tabela oficial não informa.',
        ' */',
        'export type CClassTribRaw = readonly [string, string, string, boolean | null, boolean | null, boolean | null, string, string, string | null];',
        '',
        'export const CCLASSTRIB_ROWS: readonly CClassTribRaw[] = [',
    ]
    for code, cst_code, desc, cbs, ibs, presumed, rate, start, end in rows:
        lines.append('  [' + ', '.join(js(v) for v in [code, cst_code, ' '.join(desc.split()), flag(cbs), flag(ibs), flag(presumed), rate, start, end]) + '],')
    lines += ['];', '']
    OUT.write_text('\n'.join(lines), encoding='utf-8', newline='\n')
    print(f'{len(rows)} classificações e {len(cst)} CST gravadas em {OUT} (base {version[0]} de {version[1]})')


if __name__ == '__main__':
    main()
