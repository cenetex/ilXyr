import hashlib
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

from package_reasoner_cloud import encode, members, unpack


def archive(files):
    out=io.BytesIO()
    with tarfile.open(fileobj=out,mode='w',format=tarfile.USTAR_FORMAT) as t:
        for name,data in files:
            item=tarfile.TarInfo(name);item.size=len(data);t.addfile(item,io.BytesIO(data))
    return out.getvalue()


class ArchiveTests(unittest.TestCase):
    def test_source_bytes_survive_nested_unpack_and_existing_output_is_kept(self):
        source=archive([('source.c',b'int main(void) {return 0;}\n')])
        payload={'source.tar':source,'EXECUTION-PLAN.json':b'{}\n'}
        manifest={'files':{n:{'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()} for n,b in payload.items()}}
        data=archive([*payload.items(),('PACKAGE.json',encode(manifest))])
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);path=root/'bundle.tar';path.write_bytes(data)
            unpack(path,root/'out')
            self.assertEqual((root/'out/source/source.c').read_bytes(),b'int main(void) {return 0;}\n')
            with self.assertRaises(FileExistsError):unpack(path,root/'out')
            self.assertEqual((root/'out/source/source.c').read_bytes(),b'int main(void) {return 0;}\n')

    def test_changed_member_is_rejected_before_output(self):
        manifest={'files':{'source.tar':{'bytes':3,'sha256':hashlib.sha256(b'old').hexdigest()}}}
        data=archive([('source.tar',b'new'),('PACKAGE.json',encode(manifest))])
        with tempfile.TemporaryDirectory() as name:
            root=Path(name);path=root/'bundle.tar';path.write_bytes(data)
            with self.assertRaisesRegex(ValueError,'binding differs'):unpack(path,root/'out')
            self.assertFalse((root/'out').exists())

    def test_duplicate_absolute_and_parent_members_are_rejected(self):
        for files in [[('a',b''),('a',b'')],[('/outside',b'')],[('../outside',b'')]]:
            with self.subTest(files=files),self.assertRaises(ValueError):members(archive(files))

    def test_archive_links_are_rejected(self):
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w') as t:
            item=tarfile.TarInfo('link');item.type=tarfile.SYMTYPE;item.linkname='/outside';t.addfile(item)
        with self.assertRaisesRegex(ValueError,'path or type'):members(out.getvalue())


if __name__=='__main__':unittest.main()
