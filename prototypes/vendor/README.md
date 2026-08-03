# Vendor references

- `editor/` — shallow clone of [umodoc/editor](https://github.com/umodoc/editor) used to align report hi-fi chrome (ribbon / page / statusbar) with upstream.

Refresh:

```bash
git -C prototypes/vendor/editor pull --ff-only
# or
rm -rf prototypes/vendor/editor && git clone --depth 1 https://github.com/umodoc/editor.git prototypes/vendor/editor
```
