// A small menu (Kanbaa's card menu): props().items, each
// { label, indent?, current?, hint?, action: [command, args] }, or { header: true, label } for the title
// of a section. Picking an item runs its command.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, run, closeOverlay, theme } from "herdr";

export default class StatusMenu extends View {
  render() {
    const t = theme(), { items = [], overlay } = props() ?? {};
    return v_flex().size_full().p(6).overflow_y_scrollbar().text_size(13).text_color(t.foreground).children(items.map((it, i) => it.header
      ? div().h(24).flex_none().px(8).pb(3).flex().items_end().text_size(10.5).font_semibold().text_color(t.dim).child(it.label.toUpperCase())
      : h_flex().id(`item-${i}`).h(28).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((el) => el.bg(t.hover))
        .on_click(() => { closeOverlay(overlay); run(it.action[0], it.action[1]); })
        .child(div().w(12).flex_none().text_color(t.accent).child(it.current ? "✓" : ""))
        .when(Boolean(it.indent), (el) => el.child(div().w(12).flex_none()))
        .child(div().flex_1().min_w(0).truncate().child(it.label))
        .when(Boolean(it.hint), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(11).text_color(t.dim).child(it.hint)))));
  }
}
