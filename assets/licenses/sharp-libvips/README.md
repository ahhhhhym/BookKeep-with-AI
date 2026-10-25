# libvips 及随包组件许可

此目录仅存放第三方声明与许可原文，不含库二进制、开发头文件或样本。Windows sharp 实际版本和组件版本由打包时的 `production/@img/sharp-win32-x64/versions.json` 记录；该 npm 包的 README 同时随软件分发。

- `THIRD-PARTY-NOTICES.md` 是 sharp-libvips 上游组件声明，来源 commit 与 SHA256 在 PROVENANCE.json。
- `WINDOWS-LICENSE.txt` 是 libvips 8.18.7 Windows web 开发包中的 LGPL 许可原文，原 ZIP URL、SHA256 和条目在 WINDOWS-PROVENANCE.json。仅提取许可，不使用其二进制替换 npm 锁定模块。
- LGPL-3.0.txt、GPL-3.0.txt 和 MPL-1.1.txt 为上游对应许可原文。GNU/Mozilla 原始 URL 在 WINDOWS-PROVENANCE.json。
- libvips 及 Windows 构建脚本的源代码分别见 https://github.com/libvips/libvips/tree/v8.18.7 和 https://github.com/libvips/build-win64-mxe/tree/v8.18.7；sharp 的预编译分发脚本见 https://github.com/lovell/sharp-libvips。组件原始源码入口列于上游构建库 README，按实际 versions.json 的版本选择，不以最新分支版本替代随包版本。

程序通过独立 DLL 使用 libvips，不修改其二进制；使用者可按这些许可对对应库进行调试和替换。应用源码包不等于这些第三方库的完整对应源码。公开分发前仍须按实际分发方式核对对应源码提供和通知义务；本次 S18 仅本地候选交付，不授权公开发布。
