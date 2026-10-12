#!/usr/bin/env python3
"""Arma public/i18n/<idioma>.json a partir de las traducciones por bloques de src/i18n/<idioma>/.

Formatos de entrada:
  *.tsv   «índice<TAB>traducción» (índice en src/i18n/keys.json)
  *.list  una traducción por línea, alineada con un tramo de keys.json; «=» deja el texto en español.
          El nombre indica el primer índice: c-1020.list
  patterns.json  patrones «~regex» para familias con nombres propios.
Valida que cada traducción conserve los mismos marcadores {n} que su original.
"""
import json, re, sys, pathlib

root = pathlib.Path(__file__).resolve().parents[1]
keys = json.loads((root / 'src/i18n/keys.json').read_text(encoding='utf-8'))
ph = lambda s: sorted(set(re.findall(r'\{\d+\}', s)))
ok = True
for lang_dir in sorted(p for p in (root / 'src/i18n').iterdir() if p.is_dir()):
    out, bad = {}, []
    def put(i, t, src):
        t = t.strip()
        if not t or t == '=': return
        if i >= len(keys): bad.append(f'{src}: índice {i} fuera de rango'); return
        if ph(keys[i]) != ph(t): bad.append(f'{src}: marcadores distintos en {i}: «{keys[i][:60]}» → «{t[:60]}»')
        out[keys[i]] = t
    for f in sorted(lang_dir.glob('*.tsv')):
        for n, line in enumerate(f.read_text(encoding='utf-8').splitlines(), 1):
            if not line.strip(): continue
            i, _, t = line.partition('\t')
            put(int(i), t, f'{f.name}:{n}')
    for f in sorted(lang_dir.glob('*.list')):
        start = int(re.search(r'-(\d+)\.list$', f.name).group(1))
        for n, line in enumerate(f.read_text(encoding='utf-8').splitlines()):
            put(start + n, line, f'{f.name}:{n + 1}')
    pat = lang_dir / 'patterns.json'
    if pat.exists(): out.update(json.loads(pat.read_text(encoding='utf-8')))
    (root / 'public/i18n').mkdir(exist_ok=True)
    (root / f'public/i18n/{lang_dir.name}.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    n = sum(1 for k in keys if k in out)
    print(f'{lang_dir.name}: {n} de {len(keys)} textos traducidos · {len(bad)} problemas')
    for b in bad[:40]: print('  ', b)
    ok = ok and not bad
    if '--muestra' in sys.argv:
        for i in range(1020, len(keys), 37):
            if keys[i] in out: print(f'   {i}: {keys[i][:70]} → {out[keys[i]][:70]}')
sys.exit(0 if ok else 1)
