# PyInstaller recipe for the bundled backend. Build: `npm run build:backend` (output: backend/dist/buildx-backend/).
from PyInstaller.utils.hooks import collect_submodules

a = Analysis(
    ['buildx_backend.py'],
    datas=[('alembic.ini', '.'), ('alembic/env.py', 'alembic'), ('alembic/script.py.mako', 'alembic'), ('alembic/versions/*.py', 'alembic/versions')],
    # uvicorn and the app load some modules by name at runtime.
    hiddenimports=collect_submodules('uvicorn') + collect_submodules('app'),
    excludes=['pytest'],
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='buildx-backend', console=True)
coll = COLLECT(exe, a.binaries, a.datas, name='buildx-backend')
