"""One-time: install MakeHuman asset pack zips into MPFB's user data folder.

Usage: blender --background --python blender/install_packs.py -- pack1.zip pack2.zip ...
Packs (all CC0): https://static.makehumancommunity.org/assets/assetpacks.html
  makehuman_system_assets_cc0.zip  skins, eyes, hair, clothes, teeth
  visemes01.zip                    lip-sync mouth shapes
  faceunits01.zip                  ARKit face units (expressions)
"""
import sys
import zipfile

from bl_ext.blender_org.mpfb.services import AssetService, LocationService

data_dir = LocationService.get_user_data()
for z in sys.argv[sys.argv.index('--') + 1:]:
    with zipfile.ZipFile(z) as f:
        f.extractall(data_dir)
    print('installed', z, '->', data_dir)
AssetService.update_all_asset_lists()
